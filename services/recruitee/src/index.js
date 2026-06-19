"use strict";

const SERVICE_NAME = "Recruitee";
const API_HOST = "https://api.recruitee.com";
const DEFAULT_PAGE_SIZE = 30;

const logger = {
  info: (...args) => console.log(`[${SERVICE_NAME} Service] info:`, ...args),
  debug: (...args) => console.log(`[${SERVICE_NAME} Service] debug:`, ...args),
  error: (...args) => console.log(`[${SERVICE_NAME} Service] error:`, ...args),
  warn: (...args) => console.log(`[${SERVICE_NAME} Service] warn:`, ...args),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Drops keys that are undefined, null, or empty-string so we never send noise as query params.
// Keeps meaningful falsy values like 0 and false.
function cleanupObject(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const out = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") {
      out[key] = value;
    }
  }

  return out;
}

// Normalizes a "one or many" input into an array of trimmed, non-empty values.
function toArray(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];

  return list.filter(
    (item) => item !== undefined && item !== null && item !== "",
  );
}

// Recruitee wraps collections under a resource key (e.g. { offers: [...] }). This pulls the first
// array out regardless of the exact key name, so reads stay robust to envelope differences.
function firstArray(data, keys = []) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  for (const key of keys) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

// Maps raw items into dictionary entries and applies a case-insensitive search over the label/value.
function toDictItems(items, mapFn, search) {
  const term = (search || "").toLowerCase();

  return items
    .map(mapFn)
    .filter((item) => item && (item.label || item.value))
    .filter(
      (item) =>
        !term ||
        String(item.label || "")
          .toLowerCase()
          .includes(term) ||
        String(item.value || "").toLowerCase() === term,
    );
}

/**
 * @integrationName Recruitee
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class RecruiteeService {
  /**
   * @param {Object} config
   * @param {String} config.apiToken
   * @param {String} config.companyId
   */
  constructor(config) {
    this.apiToken = config.apiToken;
    this.companyId = config.companyId;
  }

  #getBaseUrl() {
    return `${API_HOST}/c/${this.companyId}`;
  }

  #authHeader() {
    return { Authorization: `Bearer ${this.apiToken}` };
  }

  #isRateLimited(error) {
    const status = error?.status || error?.code || error?.statusCode;

    return status === 429 || /\b429\b/.test(error?.message || "");
  }

  #retryAfterMs(error) {
    const header =
      error?.headers?.["retry-after"] || error?.headers?.["Retry-After"];
    const seconds = header ? parseInt(header, 10) : NaN;

    return Number.isFinite(seconds) ? Math.min(seconds, 30) * 1000 : 3000;
  }

  #normalizeError(error, logTag) {
    const raw =
      error?.body?.error ||
      error?.body?.errors ||
      error?.body?.error_fields ||
      error?.body?.message ||
      error?.message;

    const message = typeof raw === "object" ? JSON.stringify(raw) : raw;

    logger.error(`${logTag} - api error: ${message}`);

    return new Error(message || `${SERVICE_NAME} API request failed.`);
  }

  /**
   * Central request helper. Builds an absolute call against the company API, attaches the
   * bearer token, cleans query params, and retries once on a rate-limit (429) response.
   *
   * @param {Object} options
   * @param {String} options.url - Absolute URL.
   * @param {String} [options.method] - get | post | patch | put | delete. Defaults to get.
   * @param {Object} [options.body] - JSON request body.
   * @param {Object} [options.query] - Query parameters.
   * @param {Object} [options.headers] - Extra headers.
   * @param {String} options.logTag - Label for logs.
   * @returns {Promise<any>}
   */
  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = (method || "get").toLowerCase();

    const cleanQuery = cleanupObject(query);

    const send = () => {
      const request = Flowrunner.Request[method](url)
        .set(this.#authHeader())
        .set({ Accept: "application/json", ...(headers || {}) });

      if (cleanQuery && Object.keys(cleanQuery).length) {
        request.query(cleanQuery);
      }

      if (body !== undefined && body !== null) {
        request.set({ "Content-Type": "application/json" });

        return request.send(body);
      }

      return request;
    };

    logger.debug(
      `${logTag} - api request: [${method}::${url}] q=[${JSON.stringify(cleanQuery)}]`,
    );

    try {
      return await send();
    } catch (error) {
      if (this.#isRateLimited(error)) {
        const wait = this.#retryAfterMs(error);

        logger.warn(`${logTag} - rate limited, retrying in ${wait}ms`);
        await sleep(wait);

        try {
          return await send();
        } catch (retryError) {
          if (this.#isRateLimited(retryError)) {
            throw new Error(
              `${SERVICE_NAME} rate limit reached, please retry shortly.`,
            );
          }

          throw this.#normalizeError(retryError, logTag);
        }
      }

      throw this.#normalizeError(error, logTag);
    }
  }

  // Standard "nothing was deleted" preview returned when a destructive method is called
  // without its Confirm toggle turned on.
  #deletePreview(noun, wouldDelete) {
    return {
      confirmed: false,
      deleted: false,
      wouldDelete,
      message: `Nothing was deleted. Turn on "Confirm" to permanently delete this ${noun} — this cannot be undone.`,
    };
  }

  /**
   * @operationName Test Connection
   * @category General
   * @description Checks that your API Token and Company ID are valid by looking up the signed-in user. Use this first to confirm the connection works before building a flow.
   *
   * @route POST /test-connection
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"connected":true,"companyId":"12345","user":{"id":111,"name":"Jane Recruiter","email":"jane@example.com"}}
   */
  async testConnection() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/admin`,
      logTag: "testConnection",
    });

    const user = data?.admin || data?.current_user || data || {};

    return {
      connected: true,
      companyId: this.companyId,
      user: {
        id: user.id || null,
        name: user.name || null,
        email: user.email || null,
      },
    };
  }

  // ───────────────────────────── Candidates ─────────────────────────────

  // Loads the link between a candidate and a job (its "placement"), needed to move or
  // disqualify the candidate on that job.
  async #getPlacement(jobId, candidateId) {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}/candidates/${candidateId}/placement`,
      logTag: "getPlacement",
    });

    return data?.placement || data;
  }

  // Best-effort lookup of an existing candidate by email, used for the "update if exists" option.
  async #findCandidateByEmail(email) {
    try {
      const data = await this.#apiRequest({
        url: `${this.#getBaseUrl()}/candidates/check_presence`,
        query: { email },
        logTag: "findCandidateByEmail",
      });

      const candidate = data?.candidate || firstArray(data, ["candidates"])[0];

      return candidate && candidate.id ? candidate : null;
    } catch (error) {
      logger.warn(`findCandidateByEmail - lookup skipped: ${error.message}`);

      return null;
    }
  }

  /**
   * @operationName Find Candidates
   * @category Candidates
   * @description Finds candidates in your account. Leave the search box empty to list the most recent candidates, or type a name, email, or keyword to search. You can also narrow results to a single job or by status.
   *
   * @route POST /find-candidates
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"searchText","description":"Optional. A name, email, or keyword to search for. Leave empty to list recent candidates."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","dictionary":"getJobsDictionary","description":"Optional. Limit results to candidates on this job."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["active","disqualified","hired"]}},"description":"Optional. Show only active, disqualified, or hired candidates."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many candidates to return per page (default 30)."}
   * @paramDef {"type":"String","label":"Sort by","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["created_at_desc","created_at_asc","candidate_name","candidate_rating"]}},"description":"How to order the results. Defaults to newest first."}
   *
   * @returns {Object}
   * @sampleResult {"candidates":[{"id":12345,"name":"Alex Carter","emails":["alex@example.com"],"created_at":"2025-01-20T09:00:00.000Z"}],"total":1}
   */
  async searchCandidates(searchText, jobId, status, page, limit, sortBy) {
    const pageNum = Number(page) || 1;
    const pageSize = Number(limit) || DEFAULT_PAGE_SIZE;
    const sort = sortBy || "created_at_desc";

    if (searchText) {
      const data = await this.#apiRequest({
        url: `${this.#getBaseUrl()}/search/new/candidates`,
        query: {
          query: searchText,
          page: pageNum,
          limit: pageSize,
          sort_by: sort,
        },
        logTag: "searchCandidates",
      });

      const hits = firstArray(data, ["hits", "candidates"]);

      return { candidates: hits, total: data?.total ?? hits.length };
    }

    const query = { page: pageNum, limit: pageSize, sort };

    if (jobId) {
      query.offer_id = jobId;
    }

    if (status === "disqualified") {
      query.disqualified = true;
    } else if (status === "active") {
      query.qualified = true;
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates`,
      query,
      logTag: "searchCandidates",
    });

    const candidates = firstArray(data, ["candidates"]);

    return {
      candidates,
      total: data?.total ?? data?.meta?.total_count ?? candidates.length,
    };
  }

  /**
   * @operationName Get Candidate
   * @category Candidates
   * @description Returns the full profile of one candidate, including contact details, jobs they are on, tags, and current stage.
   *
   * @route POST /get-candidate
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to look up."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"Alex Carter","emails":["alex@example.com"],"phones":["+1-555-0100"],"placements":[{"offer_id":987,"stage_name":"Interview"}],"tags":["Referral"]}
   */
  async getCandidate(candidateId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}`,
      logTag: "getCandidate",
    });

    return data?.candidate || data;
  }

  /**
   * @operationName Add Candidate
   * @category Candidates
   * @description Adds a new candidate to your account, optionally placing them on a job. Turn on "Update if already exists" to update the matching candidate instead of creating a duplicate when the email is already on file.
   *
   * @route POST /add-candidate
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Full Name","name":"name","required":true,"description":"The candidate's full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The candidate's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The candidate's phone number."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","dictionary":"getJobsDictionary","description":"Optional. Place the new candidate on this job, in its first stage."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Where the candidate came from (e.g. 'LinkedIn', 'Referral'). Shown on their profile."}
   * @paramDef {"type":"String","label":"Cover Letter","name":"coverLetter","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional cover letter or intro note saved on the profile."}
   * @paramDef {"type":"String","label":"CV / Resume Link","name":"cvUrl","description":"Optional link to a CV file (PDF, DOC). Recruitee downloads and attaches it."}
   * @paramDef {"type":"Array","label":"Tags","name":"tags","description":"Optional labels to add to the candidate, e.g. ['Senior','Remote']."}
   * @paramDef {"type":"Boolean","label":"Update if already exists","name":"updateIfExists","uiComponent":{"type":"TOGGLE"},"description":"When on, if a candidate with this email already exists, their details are updated instead of creating a duplicate."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"Alex Carter","emails":["alex@example.com"],"phones":["+1-555-0100"],"tags":["Referral"],"isNew":true}
   */
  async createCandidate(
    name,
    email,
    phone,
    jobId,
    source,
    coverLetter,
    cvUrl,
    tags,
    updateIfExists,
  ) {
    if (!name) {
      throw new Error('"Full Name" is required.');
    }

    if (updateIfExists && email) {
      const existing = await this.#findCandidateByEmail(email);

      if (existing && existing.id) {
        const updated = await this.updateCandidate(
          existing.id,
          name,
          email,
          phone,
          coverLetter,
        );

        return { ...updated, isNew: false };
      }
    }

    const candidate = cleanupObject({
      name,
      emails: email ? toArray(email) : undefined,
      phones: phone ? toArray(phone) : undefined,
      cover_letter: coverLetter,
      sources: source ? toArray(source) : undefined,
      remote_cv_url: cvUrl,
      tags: toArray(tags).length ? toArray(tags) : undefined,
    });

    const body = { candidate };
    const offers = toArray(jobId).map((id) => Number(id) || id);

    if (offers.length) {
      body.offers = offers;
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates`,
      method: "post",
      body,
      logTag: "createCandidate",
    });

    const created = data?.candidate || data;

    return { ...created, isNew: true };
  }

  /**
   * @operationName Update Candidate
   * @category Candidates
   * @description Updates a candidate's basic details. Only the fields you fill in are changed; leave a field empty to keep its current value.
   *
   * @route POST /update-candidate
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to update."}
   * @paramDef {"type":"String","label":"Full Name","name":"name","description":"New full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number."}
   * @paramDef {"type":"String","label":"Cover Letter","name":"coverLetter","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New cover letter or intro note."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"Alex Carter","emails":["alex.new@example.com"]}
   */
  async updateCandidate(candidateId, name, email, phone, coverLetter) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const candidate = cleanupObject({
      name,
      emails: email ? toArray(email) : undefined,
      phones: phone ? toArray(phone) : undefined,
      cover_letter: coverLetter,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}`,
      method: "patch",
      body: { candidate },
      logTag: "updateCandidate",
    });

    return data?.candidate || data;
  }

  /**
   * @operationName Delete Candidate
   * @category Candidates
   * @description Permanently deletes a candidate and all their data. This cannot be undone. Leave "Confirm" off first to preview who would be removed.
   *
   * @route POST /delete-candidate
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview what would be deleted. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"candidateId":12345}
   */
  async deleteCandidate(candidateId, confirm) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!confirm) {
      let summary = { id: candidateId };

      try {
        const candidate = await this.getCandidate(candidateId);

        summary = {
          id: candidate.id,
          name: candidate.name,
          emails: candidate.emails,
        };
      } catch (error) {
        logger.warn(
          `deleteCandidate - preview lookup failed: ${error.message}`,
        );
      }

      return this.#deletePreview("candidate", summary);
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}`,
      method: "delete",
      logTag: "deleteCandidate",
    });

    return { confirmed: true, deleted: true, candidateId };
  }

  /**
   * @operationName Add Candidate to Job
   * @category Candidates
   * @description Places an existing candidate onto a job's hiring pipeline, optionally in a specific stage.
   *
   * @route POST /add-candidate-to-job
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to place."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to add the candidate to."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","dependsOn":["jobId"],"description":"Optional. The pipeline stage to start them in. Defaults to the first stage."}
   *
   * @returns {Object}
   * @sampleResult {"id":55501,"candidate_id":12345,"offer_id":987,"stage_id":3001}
   */
  async assignCandidateToJob(candidateId, jobId, stageId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const placement = cleanupObject({
      candidate_id: Number(candidateId) || candidateId,
      offer_id: Number(jobId) || jobId,
      stage_id: stageId ? Number(stageId) || stageId : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/placements`,
      method: "post",
      body: { placement },
      logTag: "assignCandidateToJob",
    });

    return data?.placement || data;
  }

  /**
   * @operationName Move Candidate to Stage
   * @category Candidates
   * @description Moves one or more candidates to a different stage in a job's hiring pipeline (for example from 'Screening' to 'Interview').
   *
   * @route POST /move-candidate-to-stage
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array","label":"Candidate(s)","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"One or more candidates to move."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job whose pipeline the candidates are on."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","required":true,"dictionary":"getStagesDictionary","dependsOn":["jobId"],"description":"The stage to move the candidates into."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":987,"stageId":3002,"moved":[12345],"failed":[]}
   */
  async moveCandidateToStage(candidateId, jobId, stageId) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    if (!stageId) {
      throw new Error('"Stage" is required.');
    }

    const candidateIds = toArray(candidateId);

    if (!candidateIds.length) {
      throw new Error('"Candidate(s)" is required.');
    }

    const moved = [];
    const failed = [];

    for (const id of candidateIds) {
      try {
        const placement = await this.#getPlacement(jobId, id);

        await this.#apiRequest({
          url: `${this.#getBaseUrl()}/placements/${placement.id}/change_stage`,
          method: "patch",
          body: { stage_id: Number(stageId) || stageId },
          logTag: "moveCandidateToStage",
        });

        moved.push(id);
      } catch (error) {
        logger.warn(
          `moveCandidateToStage - candidate ${id} failed: ${error.message}`,
        );
        failed.push({ candidateId: id, error: error.message });
      }
    }

    return { jobId, stageId, moved, failed };
  }

  /**
   * @operationName Disqualify Candidate
   * @category Candidates
   * @description Disqualifies one or more candidates on a job, optionally recording a reason (e.g. 'Withdrew', 'Not a fit').
   *
   * @route POST /disqualify-candidate
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array","label":"Candidate(s)","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"One or more candidates to disqualify."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to disqualify the candidates on."}
   * @paramDef {"type":"String","label":"Reason","name":"reasonId","dictionary":"getDisqualifyReasonsDictionary","description":"Optional reason for disqualifying."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":987,"reasonId":42,"disqualified":[12345],"failed":[]}
   */
  async disqualifyCandidate(candidateId, jobId, reasonId) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const candidateIds = toArray(candidateId);

    if (!candidateIds.length) {
      throw new Error('"Candidate(s)" is required.');
    }

    const disqualified = [];
    const failed = [];

    for (const id of candidateIds) {
      try {
        const placement = await this.#getPlacement(jobId, id);

        await this.#apiRequest({
          url: `${this.#getBaseUrl()}/placements/${placement.id}/disqualify`,
          method: "patch",
          body: cleanupObject({
            disqualify_reason_id: reasonId
              ? Number(reasonId) || reasonId
              : undefined,
          }),
          logTag: "disqualifyCandidate",
        });

        disqualified.push(id);
      } catch (error) {
        logger.warn(
          `disqualifyCandidate - candidate ${id} failed: ${error.message}`,
        );
        failed.push({ candidateId: id, error: error.message });
      }
    }

    return { jobId, reasonId: reasonId || null, disqualified, failed };
  }

  /**
   * @operationName Restore (Requalify) Candidate
   * @category Candidates
   * @description Reverses a disqualification, putting one or more candidates back into a job's active pipeline.
   *
   * @route POST /restore-candidate
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array","label":"Candidate(s)","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"One or more candidates to restore."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to restore the candidates on."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":987,"restored":[12345],"failed":[]}
   */
  async restoreCandidate(candidateId, jobId) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const candidateIds = toArray(candidateId);

    if (!candidateIds.length) {
      throw new Error('"Candidate(s)" is required.');
    }

    const restored = [];
    const failed = [];

    for (const id of candidateIds) {
      try {
        const placement = await this.#getPlacement(jobId, id);

        await this.#apiRequest({
          url: `${this.#getBaseUrl()}/placements/${placement.id}/requalify`,
          method: "patch",
          logTag: "restoreCandidate",
        });

        restored.push(id);
      } catch (error) {
        logger.warn(
          `restoreCandidate - candidate ${id} failed: ${error.message}`,
        );
        failed.push({ candidateId: id, error: error.message });
      }
    }

    return { jobId, restored, failed };
  }

  /**
   * @operationName Add Tags to Candidate
   * @category Candidates
   * @description Adds one or more tags (labels) to a candidate. Tags that don't exist yet are created automatically.
   *
   * @route POST /add-candidate-tags
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to tag."}
   * @paramDef {"type":"Array","label":"Tags","name":"tags","required":true,"description":"One or more tags to add, e.g. ['Reviewed','Top Pick']."}
   *
   * @returns {Object}
   * @sampleResult {"candidateId":12345,"tagsAdded":["Reviewed","Top Pick"]}
   */
  async addCandidateTags(candidateId, tags) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const tagList = toArray(tags);

    if (!tagList.length) {
      throw new Error('"Tags" is required.');
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}/tags`,
      method: "post",
      body: { tags: tagList },
      logTag: "addCandidateTags",
    });

    return { candidateId, tagsAdded: tagList };
  }

  /**
   * @operationName Add Source to Candidate
   * @category Candidates
   * @description Records where a candidate came from (for example 'LinkedIn' or 'Referral'). Useful for tracking your best hiring channels.
   *
   * @route POST /add-candidate-source
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to update."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":true,"description":"The source to record, e.g. 'LinkedIn'."}
   *
   * @returns {Object}
   * @sampleResult {"candidateId":12345,"sourcesAdded":["LinkedIn"]}
   */
  async addCandidateSource(candidateId, source) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!source) {
      throw new Error('"Source" is required.');
    }

    const sources = toArray(source);

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}/sources`,
      method: "post",
      body: { sources },
      logTag: "addCandidateSource",
    });

    return { candidateId, sourcesAdded: sources };
  }

  /**
   * @operationName Add Candidate to Talent Pool
   * @category Candidates
   * @description Adds a candidate to a talent pool so you can keep them on file for future roles.
   *
   * @route POST /add-candidate-to-talent-pool
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to add."}
   * @paramDef {"type":"String","label":"Talent Pool","name":"talentPoolId","required":true,"dictionary":"getTalentPoolsDictionary","description":"The talent pool to add them to."}
   *
   * @returns {Object}
   * @sampleResult {"id":55502,"candidate_id":12345,"offer_id":654}
   */
  async addCandidateToTalentPool(candidateId, talentPoolId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!talentPoolId) {
      throw new Error('"Talent Pool" is required.');
    }

    const placement = {
      candidate_id: Number(candidateId) || candidateId,
      offer_id: Number(talentPoolId) || talentPoolId,
    };

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/placements`,
      method: "post",
      body: { placement },
      logTag: "addCandidateToTalentPool",
    });

    return data?.placement || data;
  }

  /**
   * @operationName Parse Candidate CV
   * @category Candidates
   * @description Re-reads the candidate's current CV and fills in details like work history, education, and skills from it.
   *
   * @route POST /parse-candidate-cv
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate whose CV should be parsed."}
   *
   * @returns {Object}
   * @sampleResult {"candidateId":12345,"parsed":true}
   */
  async parseCandidateCv(candidateId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}/parse_cv`,
      method: "post",
      logTag: "parseCandidateCv",
    });

    return { candidateId, parsed: true, result: data || null };
  }

  /**
   * @operationName Merge Candidates
   * @category Candidates
   * @description Merges a duplicate candidate profile into a main one, combining their history into a single profile.
   *
   * @route POST /merge-candidates
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Main Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The profile to keep."}
   * @paramDef {"type":"String","label":"Duplicate Candidate","name":"duplicateId","required":true,"dictionary":"getCandidatesDictionary","description":"The duplicate profile to merge into the main one."}
   *
   * @returns {Object}
   * @sampleResult {"candidateId":12345,"mergedFrom":67890,"merged":true}
   */
  async mergeCandidates(candidateId, duplicateId) {
    if (!candidateId) {
      throw new Error('"Main Candidate" is required.');
    }

    if (!duplicateId) {
      throw new Error('"Duplicate Candidate" is required.');
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}/merge`,
      method: "patch",
      body: { ids: toArray(duplicateId).map((id) => Number(id) || id) },
      logTag: "mergeCandidates",
    });

    return { candidateId, mergedFrom: duplicateId, merged: true };
  }

  // ───────────────────────────── Dictionaries ─────────────────────────────

  // Shared loader: fetches one page of a list endpoint and shapes it into dropdown entries.
  async #fetchDictionary({ url, keys, query, search, cursor, mapFn, logTag }) {
    const page = Number(cursor) || 1;

    const data = await this.#apiRequest({
      url,
      query: cleanupObject({
        ...(query || {}),
        limit: DEFAULT_PAGE_SIZE,
        page,
      }),
      logTag,
    });

    const raw = firstArray(data, keys);
    const items = toDictItems(raw, mapFn, search);
    const nextCursor = raw.length >= DEFAULT_PAGE_SIZE ? page + 1 : null;

    return { items, cursor: nextCursor };
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Jobs
   * @description Searchable list of jobs (offers) for choosing a job in a flow.
   * @route POST /get-jobs-dictionary
   * @paramDef {"type":"getJobsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Senior Engineer","value":"987","note":"Berlin · published"}],"cursor":null}
   */
  async getJobsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/offers`,
      keys: ["offers"],
      query: { scope: "not_archived", view_mode: "brief" },
      search,
      cursor,
      logTag: "getJobsDictionary",
      mapFn: (offer) => {
        if (offer && offer.kind === "talent_pool") {
          return null;
        }

        const where =
          offer?.location ||
          offer?.city ||
          (offer?.locations && offer.locations[0]?.name);

        return {
          label: offer?.title || "Untitled job",
          value: String(offer?.id),
          note: [where, offer?.status].filter(Boolean).join(" · "),
        };
      },
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Talent Pools
   * @description Searchable list of talent pools.
   * @route POST /get-talent-pools-dictionary
   * @paramDef {"type":"getTalentPoolsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Future Designers","value":"654","note":"talent pool"}],"cursor":null}
   */
  async getTalentPoolsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/talent_pools`,
      keys: ["talent_pools", "offers"],
      search,
      cursor,
      logTag: "getTalentPoolsDictionary",
      mapFn: (pool) => ({
        label: pool?.title || "Untitled pool",
        value: String(pool?.id),
        note: "talent pool",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Candidates
   * @description Searchable list of candidates.
   * @route POST /get-candidates-dictionary
   * @paramDef {"type":"getCandidatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Carter","value":"12345","note":"alex@example.com"}],"cursor":null}
   */
  async getCandidatesDictionary(payload) {
    const { search, cursor } = payload || {};

    if (search) {
      const data = await this.#apiRequest({
        url: `${this.#getBaseUrl()}/search/new/candidates`,
        query: {
          query: search,
          limit: DEFAULT_PAGE_SIZE,
          page: Number(cursor) || 1,
        },
        logTag: "getCandidatesDictionary",
      });

      const hits = firstArray(data, ["hits", "candidates"]);

      return {
        items: hits.map((c) => ({
          label: c?.name || "Unnamed candidate",
          value: String(c?.id),
          note: (c?.emails && c.emails[0]) || "",
        })),
        cursor:
          hits.length >= DEFAULT_PAGE_SIZE ? (Number(cursor) || 1) + 1 : null,
      };
    }

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/candidates`,
      keys: ["candidates"],
      query: { sort: "created_at_desc" },
      cursor,
      logTag: "getCandidatesDictionary",
      mapFn: (c) => ({
        label: c?.name || "Unnamed candidate",
        value: String(c?.id),
        note: (c?.emails && c.emails[0]) || "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags
   * @description Searchable list of candidate tags.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Referral","value":"7","note":""}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/tags`,
      keys: ["tags"],
      search,
      cursor,
      logTag: "getTagsDictionary",
      mapFn: (tag) => ({
        label: tag?.name || String(tag?.id),
        value: String(tag?.id ?? tag?.name),
        note:
          tag?.taggings_count != null ? `${tag.taggings_count} candidates` : "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sources
   * @description Searchable list of candidate sources.
   * @route POST /get-sources-dictionary
   * @paramDef {"type":"getSourcesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"LinkedIn","value":"3","note":""}],"cursor":null}
   */
  async getSourcesDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/sources`,
      keys: ["sources"],
      search,
      cursor,
      logTag: "getSourcesDictionary",
      mapFn: (source) => ({
        label: source?.name || String(source?.id),
        value: String(source?.id ?? source?.name),
        note: "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Disqualify Reasons
   * @description Searchable list of disqualify reasons.
   * @route POST /get-disqualify-reasons-dictionary
   * @paramDef {"type":"getDisqualifyReasonsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Not a fit","value":"42","note":""}],"cursor":null}
   */
  async getDisqualifyReasonsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/disqualify_reasons`,
      keys: ["disqualify_reasons"],
      search,
      cursor,
      logTag: "getDisqualifyReasonsDictionary",
      mapFn: (reason) => ({
        label: reason?.name || String(reason?.id),
        value: String(reason?.id),
        note: "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Departments
   * @description Searchable list of departments.
   * @route POST /get-departments-dictionary
   * @paramDef {"type":"getDepartmentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"5","note":""}],"cursor":null}
   */
  async getDepartmentsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/departments`,
      keys: ["departments"],
      search,
      cursor,
      logTag: "getDepartmentsDictionary",
      mapFn: (dept) => ({
        label: dept?.name || String(dept?.id),
        value: String(dept?.id),
        note: "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations
   * @description Searchable list of office locations.
   * @route POST /get-locations-dictionary
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Berlin","value":"21","note":"Germany"}],"cursor":null}
   */
  async getLocationsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/locations`,
      keys: ["locations"],
      search,
      cursor,
      logTag: "getLocationsDictionary",
      mapFn: (loc) => ({
        label: loc?.name || loc?.city || String(loc?.id),
        value: String(loc?.id),
        note: loc?.country || loc?.country_code || "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Team Members
   * @description Searchable list of hiring team members (admins) in your account.
   * @route POST /get-admins-dictionary
   * @paramDef {"type":"getAdminsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Recruiter","value":"111","note":"jane@example.com"}],"cursor":null}
   */
  async getAdminsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/admins`,
      keys: ["admins"],
      search,
      cursor,
      logTag: "getAdminsDictionary",
      mapFn: (admin) => ({
        label: admin?.name || admin?.email || String(admin?.id),
        value: String(admin?.id),
        note: admin?.email || "",
      }),
    });
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stages
   * @description Lists the pipeline stages of a chosen job, so you can pick the stage to move candidates into.
   * @route POST /get-stages-dictionary
   * @paramDef {"type":"getStagesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and the job to read stages from."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Applied","value":"3001","note":"apply"},{"label":"Interview","value":"3002","note":"interview"}],"cursor":null}
   */
  async getStagesDictionary(payload) {
    const { search, criteria } = payload || {};
    const jobId = criteria?.jobId;

    if (!jobId) {
      return { items: [], cursor: null };
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}`,
      logTag: "getStagesDictionary",
    });

    const offer = data?.offer || data;
    const stages =
      offer?.pipeline_template?.stages ||
      offer?.stages ||
      firstArray(offer?.pipeline_template, ["stages"]) ||
      [];

    return {
      items: toDictItems(
        stages,
        (stage) => ({
          label: stage?.name || String(stage?.id),
          value: String(stage?.id),
          note: stage?.category || stage?.kind || "",
        }),
        search,
      ),
      cursor: null,
    };
  }

  // ───────────────────────────── Jobs ─────────────────────────────

  // Reads the pipeline stages embedded in an offer, trying the few shapes Recruitee uses.
  #extractStages(offer) {
    return (
      offer?.pipeline_template?.stages ||
      offer?.stages ||
      firstArray(offer?.pipeline_template, ["stages"]) ||
      []
    );
  }

  /**
   * @operationName Find Jobs
   * @category Jobs
   * @description Lists the jobs in your account. By default this shows current (non-archived) jobs; turn on "Include archived" or pick a status to change that.
   *
   * @route POST /find-jobs
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["published","internal","draft","closed"]}},"description":"Optional. Show only jobs with this status."}
   * @paramDef {"type":"Boolean","label":"Include archived","name":"includeArchived","uiComponent":{"type":"TOGGLE"},"description":"When on, archived jobs are included."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many jobs per page (default 30)."}
   *
   * @returns {Object}
   * @sampleResult {"jobs":[{"id":987,"title":"Senior Engineer","status":"published","candidates_count":12}],"total":1}
   */
  async listJobs(status, includeArchived, page, limit) {
    const query = cleanupObject({
      scope: status || (includeArchived ? "archived" : "not_archived"),
      page: Number(page) || 1,
      limit: Number(limit) || DEFAULT_PAGE_SIZE,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers`,
      query,
      logTag: "listJobs",
    });

    const jobs = firstArray(data, ["offers"]).filter(
      (offer) => offer?.kind !== "talent_pool",
    );

    return { jobs, total: data?.total ?? jobs.length };
  }

  /**
   * @operationName Get Job
   * @category Jobs
   * @description Returns the full details of one job, including its description, location, department, and pipeline.
   *
   * @route POST /get-job
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to look up."}
   *
   * @returns {Object}
   * @sampleResult {"id":987,"title":"Senior Engineer","status":"published","description":"...","department":"Engineering"}
   */
  async getJob(jobId) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}`,
      logTag: "getJob",
    });

    return data?.offer || data;
  }

  /**
   * @operationName Create Job
   * @category Jobs
   * @description Creates a new job. It starts as a draft so you can review it before publishing with "Update Job Status".
   *
   * @route POST /create-job
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The job title, e.g. 'Senior Software Engineer'."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The job description shown to candidates."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department for the job."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Optional office location for the job."}
   * @paramDef {"type":"String","label":"Employment Type","name":"employmentType","uiComponent":{"type":"DROPDOWN","options":{"values":["full_time","part_time","contract","temporary","internship","freelance"]}},"description":"Optional type of employment."}
   * @paramDef {"type":"Boolean","label":"Remote","name":"remote","uiComponent":{"type":"TOGGLE"},"description":"Mark the job as remote."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"additionalFields","description":"Optional. Any additional Recruitee offer fields as a JSON object, merged into the request."}
   *
   * @returns {Object}
   * @sampleResult {"id":987,"title":"Senior Software Engineer","status":"draft"}
   */
  async createJob(
    title,
    description,
    departmentId,
    locationId,
    employmentType,
    remote,
    additionalFields,
  ) {
    if (!title) {
      throw new Error('"Title" is required.');
    }

    const offer = cleanupObject({
      title,
      description,
      kind: "job",
      department_id: departmentId
        ? Number(departmentId) || departmentId
        : undefined,
      location_ids: locationId ? [Number(locationId) || locationId] : undefined,
      employment_type: employmentType,
      remote: typeof remote === "boolean" ? remote : undefined,
      ...(additionalFields && typeof additionalFields === "object"
        ? additionalFields
        : {}),
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers`,
      method: "post",
      body: { offer },
      logTag: "createJob",
    });

    return data?.offer || data;
  }

  /**
   * @operationName Update Job
   * @category Jobs
   * @description Updates a job's details. Only the fields you fill in are changed.
   *
   * @route POST /update-job
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New job title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New job description."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"New department."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"additionalFields","description":"Optional. Any additional Recruitee offer fields as a JSON object, merged into the request."}
   *
   * @returns {Object}
   * @sampleResult {"id":987,"title":"Staff Software Engineer","status":"published"}
   */
  async updateJob(jobId, title, description, departmentId, additionalFields) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const offer = cleanupObject({
      title,
      description,
      department_id: departmentId
        ? Number(departmentId) || departmentId
        : undefined,
      ...(additionalFields && typeof additionalFields === "object"
        ? additionalFields
        : {}),
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}`,
      method: "patch",
      body: { offer },
      logTag: "updateJob",
    });

    return data?.offer || data;
  }

  /**
   * @operationName Update Job Status
   * @category Jobs
   * @description Changes whether a job is published, internal-only, closed, archived, or a draft — all in one place.
   *
   * @route POST /update-job-status
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to update."}
   * @paramDef {"type":"String","label":"New Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["publish","unpublish","close","archive","unarchive","draft"]}},"description":"Publish puts the job live; unpublish hides it; close stops new applications; archive/unarchive move it out of or back into your active list; draft returns it to editing."}
   *
   * @returns {Object}
   * @sampleResult {"id":987,"status":"published"}
   */
  async updateJobStatus(jobId, status) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const allowed = [
      "publish",
      "unpublish",
      "close",
      "archive",
      "unarchive",
      "draft",
    ];

    if (!allowed.includes(status)) {
      throw new Error(`"New Status" must be one of: ${allowed.join(", ")}.`);
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}/${status}`,
      method: "patch",
      logTag: "updateJobStatus",
    });

    return data?.offer || data || { id: jobId, status };
  }

  /**
   * @operationName Duplicate Job
   * @category Jobs
   * @description Creates a copy of an existing job as a new draft, so you can quickly post a similar role.
   *
   * @route POST /duplicate-job
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to copy."}
   *
   * @returns {Object}
   * @sampleResult {"id":988,"title":"Senior Engineer (copy)","status":"draft"}
   */
  async duplicateJob(jobId) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}/duplicate`,
      method: "patch",
      logTag: "duplicateJob",
    });

    return data?.offer || data;
  }

  /**
   * @operationName Delete Job
   * @category Jobs
   * @description Permanently deletes a job (or talent pool) and its candidate links. This cannot be undone. Leave "Confirm" off to preview first. To simply close a job, use "Update Job Status" instead.
   *
   * @route POST /delete-job
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview what would be deleted. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"jobId":987}
   */
  async deleteJob(jobId, confirm) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    if (!confirm) {
      let summary = { id: jobId };

      try {
        const job = await this.getJob(jobId);

        summary = { id: job.id, title: job.title, status: job.status };
      } catch (error) {
        logger.warn(`deleteJob - preview lookup failed: ${error.message}`);
      }

      return this.#deletePreview("job", summary);
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}`,
      method: "delete",
      logTag: "deleteJob",
    });

    return { confirmed: true, deleted: true, jobId };
  }

  /**
   * @operationName Tag Job
   * @category Jobs
   * @description Adds or removes labels on a job, making it easier to group and find jobs.
   *
   * @route POST /tag-job
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to tag."}
   * @paramDef {"type":"Array","label":"Tags","name":"tags","required":true,"description":"One or more job tags, e.g. ['Urgent','Leadership']."}
   * @paramDef {"type":"String","label":"Action","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["add","remove"]}},"description":"Add the tags or remove them. Defaults to add."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":987,"action":"add","tags":["Urgent"]}
   */
  async tagJob(jobId, tags, action) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const tagList = toArray(tags);

    if (!tagList.length) {
      throw new Error('"Tags" is required.');
    }

    const remove = action === "remove";

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}/offer_tags`,
      method: remove ? "delete" : "post",
      body: { tags: tagList },
      logTag: "tagJob",
    });

    return { jobId, action: remove ? "remove" : "add", tags: tagList };
  }

  /**
   * @operationName Get Job Candidates
   * @category Jobs
   * @description Lists the candidates currently on a job's pipeline, along with the stage each one is in.
   *
   * @route POST /get-job-candidates
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to read candidates from."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many candidates per page (default 30)."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":987,"placements":[{"id":55501,"candidate_id":12345,"stage_name":"Interview"}]}
   */
  async getJobCandidates(jobId, page, limit) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}/placements`,
      query: cleanupObject({
        page: Number(page) || 1,
        limit: Number(limit) || DEFAULT_PAGE_SIZE,
      }),
      logTag: "getJobCandidates",
    });

    return { jobId, placements: firstArray(data, ["placements"]) };
  }

  /**
   * @operationName List Job Stages
   * @category Jobs
   * @description Lists the hiring pipeline stages for a job (for example Applied, Screening, Interview, Hired).
   *
   * @route POST /list-pipeline-stages
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job whose stages to list."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":987,"stages":[{"id":3001,"name":"Applied","category":"apply"}]}
   */
  async listPipelineStages(jobId) {
    if (!jobId) {
      throw new Error('"Job" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/offers/${jobId}`,
      logTag: "listPipelineStages",
    });

    return { jobId, stages: this.#extractStages(data?.offer || data) };
  }

  // ───────────────────────────── Pipeline templates ─────────────────────────────

  /**
   * @operationName List Pipeline Templates
   * @category Pipeline
   * @description Lists the reusable hiring pipeline templates in your account.
   *
   * @route POST /list-pipeline-templates
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"pipelineTemplates":[{"id":7,"name":"Standard Hiring"}]}
   */
  async listPipelineTemplates() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates`,
      logTag: "listPipelineTemplates",
    });

    return { pipelineTemplates: firstArray(data, ["pipeline_templates"]) };
  }

  /**
   * @operationName Get Pipeline Template
   * @category Pipeline
   * @description Returns one pipeline template with its stages.
   *
   * @route POST /get-pipeline-template
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Pipeline Template","name":"templateId","required":true,"dictionary":"getPipelineTemplatesDictionary","description":"The template to look up."}
   *
   * @returns {Object}
   * @sampleResult {"id":7,"name":"Standard Hiring","stages":[{"id":3001,"name":"Applied"}]}
   */
  async getPipelineTemplate(templateId) {
    if (!templateId) {
      throw new Error('"Pipeline Template" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates/${templateId}`,
      logTag: "getPipelineTemplate",
    });

    return data?.pipeline_template || data;
  }

  /**
   * @operationName Create Pipeline Template
   * @category Pipeline
   * @description Creates a new reusable hiring pipeline template.
   *
   * @route POST /create-pipeline-template
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the template, e.g. 'Engineering Hiring'."}
   *
   * @returns {Object}
   * @sampleResult {"id":8,"name":"Engineering Hiring"}
   */
  async createPipelineTemplate(name) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates`,
      method: "post",
      body: { pipeline_template: { name } },
      logTag: "createPipelineTemplate",
    });

    return data?.pipeline_template || data;
  }

  /**
   * @operationName Update Pipeline Template
   * @category Pipeline
   * @description Renames an existing pipeline template.
   *
   * @route POST /update-pipeline-template
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Pipeline Template","name":"templateId","required":true,"dictionary":"getPipelineTemplatesDictionary","description":"The template to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New name for the template."}
   *
   * @returns {Object}
   * @sampleResult {"id":8,"name":"Engineering Hiring v2"}
   */
  async updatePipelineTemplate(templateId, name) {
    if (!templateId) {
      throw new Error('"Pipeline Template" is required.');
    }

    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates/${templateId}`,
      method: "patch",
      body: { pipeline_template: { name } },
      logTag: "updatePipelineTemplate",
    });

    return data?.pipeline_template || data;
  }

  /**
   * @operationName Delete Pipeline Template
   * @category Pipeline
   * @description Permanently deletes a pipeline template. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-pipeline-template
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Pipeline Template","name":"templateId","required":true,"dictionary":"getPipelineTemplatesDictionary","description":"The template to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview what would be deleted. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"templateId":8}
   */
  async deletePipelineTemplate(templateId, confirm) {
    if (!templateId) {
      throw new Error('"Pipeline Template" is required.');
    }

    if (!confirm) {
      let summary = { id: templateId };

      try {
        const template = await this.getPipelineTemplate(templateId);

        summary = { id: template.id, name: template.name };
      } catch (error) {
        logger.warn(
          `deletePipelineTemplate - preview lookup failed: ${error.message}`,
        );
      }

      return this.#deletePreview("pipeline template", summary);
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates/${templateId}`,
      method: "delete",
      logTag: "deletePipelineTemplate",
    });

    return { confirmed: true, deleted: true, templateId };
  }

  /**
   * @operationName Add Pipeline Stage
   * @category Pipeline
   * @description Adds a new stage to a pipeline template.
   *
   * @route POST /add-pipeline-stage
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Pipeline Template","name":"templateId","required":true,"dictionary":"getPipelineTemplatesDictionary","description":"The template to add a stage to."}
   * @paramDef {"type":"String","label":"Stage Name","name":"name","required":true,"description":"Name of the new stage, e.g. 'Phone Screen'."}
   * @paramDef {"type":"String","label":"Stage Type","name":"category","uiComponent":{"type":"DROPDOWN","options":{"values":["apply","phone_screen","interview","evaluation","offer","hired"]}},"description":"Optional type that controls how the stage behaves."}
   *
   * @returns {Object}
   * @sampleResult {"id":3010,"name":"Phone Screen","category":"phone_screen"}
   */
  async addPipelineStage(templateId, name, category) {
    if (!templateId) {
      throw new Error('"Pipeline Template" is required.');
    }

    if (!name) {
      throw new Error('"Stage Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates/${templateId}/stages`,
      method: "post",
      body: { stage: cleanupObject({ name, category }) },
      logTag: "addPipelineStage",
    });

    return data?.stage || data;
  }

  /**
   * @operationName Update Pipeline Stage
   * @category Pipeline
   * @description Renames a stage within a pipeline template.
   *
   * @route POST /update-pipeline-stage
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Pipeline Template","name":"templateId","required":true,"dictionary":"getPipelineTemplatesDictionary","description":"The template the stage belongs to."}
   * @paramDef {"type":"String","label":"Stage ID","name":"stageId","required":true,"description":"The numeric ID of the stage to update."}
   * @paramDef {"type":"String","label":"Stage Name","name":"name","required":true,"description":"New name for the stage."}
   *
   * @returns {Object}
   * @sampleResult {"id":3010,"name":"Recruiter Screen"}
   */
  async updatePipelineStage(templateId, stageId, name) {
    if (!templateId) {
      throw new Error('"Pipeline Template" is required.');
    }

    if (!stageId) {
      throw new Error('"Stage ID" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates/${templateId}/stages/${stageId}`,
      method: "patch",
      body: { stage: cleanupObject({ name }) },
      logTag: "updatePipelineStage",
    });

    return data?.stage || data;
  }

  /**
   * @operationName Delete Pipeline Stage
   * @category Pipeline
   * @description Deletes a stage from a pipeline template, moving any candidates in it to another stage you choose. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-pipeline-stage
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Pipeline Template","name":"templateId","required":true,"dictionary":"getPipelineTemplatesDictionary","description":"The template the stage belongs to."}
   * @paramDef {"type":"String","label":"Stage ID","name":"stageId","required":true,"description":"The numeric ID of the stage to delete."}
   * @paramDef {"type":"String","label":"Move Candidates To Stage ID","name":"destinationStageId","required":true,"description":"The numeric ID of the stage to move existing candidates into."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to delete the stage — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"stageId":3010,"movedTo":3001}
   */
  async deletePipelineStage(templateId, stageId, destinationStageId, confirm) {
    if (!templateId) {
      throw new Error('"Pipeline Template" is required.');
    }

    if (!stageId) {
      throw new Error('"Stage ID" is required.');
    }

    if (!destinationStageId) {
      throw new Error('"Move Candidates To Stage ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("pipeline stage", {
        stageId,
        movedTo: destinationStageId,
      });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/pipeline_templates/${templateId}/stages/delete_and_move_placements/${stageId}`,
      method: "patch",
      body: {
        destination_stage_id: Number(destinationStageId) || destinationStageId,
      },
      logTag: "deletePipelineStage",
    });

    return {
      confirmed: true,
      deleted: true,
      stageId,
      movedTo: destinationStageId,
    };
  }

  // ───────────────────────────── Disqualify reasons ─────────────────────────────

  /**
   * @operationName List Disqualify Reasons
   * @category Organization
   * @description Lists the reasons your team can use when disqualifying candidates.
   *
   * @route POST /list-disqualify-reasons
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"reasons":[{"id":42,"name":"Not a fit"}]}
   */
  async listDisqualifyReasons() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/disqualify_reasons`,
      logTag: "listDisqualifyReasons",
    });

    return { reasons: firstArray(data, ["disqualify_reasons"]) };
  }

  /**
   * @operationName Create Disqualify Reason
   * @category Organization
   * @description Adds a new disqualify reason your team can choose from.
   *
   * @route POST /create-disqualify-reason
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The reason text, e.g. 'Salary expectations'."}
   *
   * @returns {Object}
   * @sampleResult {"id":43,"name":"Salary expectations"}
   */
  async createDisqualifyReason(name) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/disqualify_reasons`,
      method: "post",
      body: { disqualify_reason: { name } },
      logTag: "createDisqualifyReason",
    });

    return data?.disqualify_reason || data;
  }

  /**
   * @operationName Update Disqualify Reason
   * @category Organization
   * @description Renames an existing disqualify reason.
   *
   * @route POST /update-disqualify-reason
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Reason","name":"reasonId","required":true,"dictionary":"getDisqualifyReasonsDictionary","description":"The reason to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New reason text."}
   *
   * @returns {Object}
   * @sampleResult {"id":43,"name":"Salary too high"}
   */
  async updateDisqualifyReason(reasonId, name) {
    if (!reasonId) {
      throw new Error('"Reason" is required.');
    }

    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/disqualify_reasons/${reasonId}`,
      method: "patch",
      body: { disqualify_reason: { name } },
      logTag: "updateDisqualifyReason",
    });

    return data?.disqualify_reason || data;
  }

  /**
   * @operationName Delete Disqualify Reason
   * @category Organization
   * @description Permanently deletes a disqualify reason. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-disqualify-reason
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Reason","name":"reasonId","required":true,"dictionary":"getDisqualifyReasonsDictionary","description":"The reason to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"reasonId":43}
   */
  async deleteDisqualifyReason(reasonId, confirm) {
    if (!reasonId) {
      throw new Error('"Reason" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("disqualify reason", { id: reasonId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/disqualify_reasons/${reasonId}`,
      method: "delete",
      logTag: "deleteDisqualifyReason",
    });

    return { confirmed: true, deleted: true, reasonId };
  }

  // ───────────────────────────── Departments & locations ─────────────────────────────

  /**
   * @operationName List Departments
   * @category Organization
   * @description Lists the departments in your account.
   *
   * @route POST /list-departments
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"departments":[{"id":5,"name":"Engineering"}]}
   */
  async listDepartments() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/departments`,
      logTag: "listDepartments",
    });

    return { departments: firstArray(data, ["departments"]) };
  }

  /**
   * @operationName Create Department
   * @category Organization
   * @description Adds a new department.
   *
   * @route POST /create-department
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The department name, e.g. 'Marketing'."}
   *
   * @returns {Object}
   * @sampleResult {"id":6,"name":"Marketing"}
   */
  async createDepartment(name) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/departments`,
      method: "post",
      body: { department: { name } },
      logTag: "createDepartment",
    });

    return data?.department || data;
  }

  /**
   * @operationName Delete Department
   * @category Organization
   * @description Permanently deletes a department. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-department
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Department","name":"departmentId","required":true,"dictionary":"getDepartmentsDictionary","description":"The department to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"departmentId":6}
   */
  async deleteDepartment(departmentId, confirm) {
    if (!departmentId) {
      throw new Error('"Department" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("department", { id: departmentId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/departments/${departmentId}`,
      method: "delete",
      logTag: "deleteDepartment",
    });

    return { confirmed: true, deleted: true, departmentId };
  }

  /**
   * @operationName List Locations
   * @category Organization
   * @description Lists the office locations in your account.
   *
   * @route POST /list-locations
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"locations":[{"id":21,"name":"Berlin","country":"Germany"}]}
   */
  async listLocations() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/locations`,
      logTag: "listLocations",
    });

    return { locations: firstArray(data, ["locations"]) };
  }

  /**
   * @operationName Create Location
   * @category Organization
   * @description Adds a new office location.
   *
   * @route POST /create-location
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the location, e.g. 'Berlin HQ'."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City for the location."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Country for the location."}
   *
   * @returns {Object}
   * @sampleResult {"id":22,"name":"Berlin HQ","city":"Berlin","country":"Germany"}
   */
  async createLocation(name, city, country) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/locations`,
      method: "post",
      body: { location: cleanupObject({ name, city, country }) },
      logTag: "createLocation",
    });

    return data?.location || data;
  }

  /**
   * @operationName Delete Location
   * @category Organization
   * @description Permanently deletes an office location. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-location
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"locationId":22}
   */
  async deleteLocation(locationId, confirm) {
    if (!locationId) {
      throw new Error('"Location" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("location", { id: locationId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/locations/${locationId}`,
      method: "delete",
      logTag: "deleteLocation",
    });

    return { confirmed: true, deleted: true, locationId };
  }

  // ───────────────────────────── Tags, sources, talent pools, team ─────────────────────────────

  /**
   * @operationName List Tags
   * @category Organization
   * @description Lists all candidate tags used in your account.
   *
   * @route POST /list-tags
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"tags":[{"id":7,"name":"Referral"}]}
   */
  async listTags() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tags`,
      logTag: "listTags",
    });

    return { tags: firstArray(data, ["tags"]) };
  }

  /**
   * @operationName List Sources
   * @category Organization
   * @description Lists all candidate sources used in your account.
   *
   * @route POST /list-sources
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"sources":[{"id":3,"name":"LinkedIn"}]}
   */
  async listSources() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/sources`,
      logTag: "listSources",
    });

    return { sources: firstArray(data, ["sources"]) };
  }

  /**
   * @operationName List Talent Pools
   * @category Organization
   * @description Lists the talent pools in your account.
   *
   * @route POST /list-talent-pools
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many talent pools per page (default 30)."}
   *
   * @returns {Object}
   * @sampleResult {"talentPools":[{"id":654,"title":"Future Designers"}]}
   */
  async listTalentPools(page, limit) {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/talent_pools`,
      query: cleanupObject({
        page: Number(page) || 1,
        limit: Number(limit) || DEFAULT_PAGE_SIZE,
      }),
      logTag: "listTalentPools",
    });

    return { talentPools: firstArray(data, ["talent_pools", "offers"]) };
  }

  /**
   * @operationName Create Talent Pool
   * @category Organization
   * @description Creates a new talent pool to keep promising candidates on file for future roles.
   *
   * @route POST /create-talent-pool
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"A name for the talent pool, e.g. 'Senior Designers'."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the talent pool."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department for the talent pool."}
   *
   * @returns {Object}
   * @sampleResult {"id":655,"title":"Senior Designers","kind":"talent_pool"}
   */
  async createTalentPool(title, description, departmentId) {
    if (!title) {
      throw new Error('"Title" is required.');
    }

    const talentPool = cleanupObject({
      title,
      description,
      department_id: departmentId
        ? Number(departmentId) || departmentId
        : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/talent_pools`,
      method: "post",
      body: { talent_pool: talentPool },
      logTag: "createTalentPool",
    });

    return data?.talent_pool || data?.offer || data;
  }

  /**
   * @operationName List Team Members
   * @category Organization
   * @description Lists the hiring team members (admins) in your account.
   *
   * @route POST /list-team-members
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"teamMembers":[{"id":111,"name":"Jane Recruiter","email":"jane@example.com"}]}
   */
  async listTeamMembers() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/admins`,
      logTag: "listTeamMembers",
    });

    return { teamMembers: firstArray(data, ["admins"]) };
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipeline Templates
   * @description Searchable list of pipeline templates.
   * @route POST /get-pipeline-templates-dictionary
   * @paramDef {"type":"getPipelineTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard Hiring","value":"7","note":""}],"cursor":null}
   */
  async getPipelineTemplatesDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/pipeline_templates`,
      keys: ["pipeline_templates"],
      search,
      cursor,
      logTag: "getPipelineTemplatesDictionary",
      mapFn: (template) => ({
        label: template?.name || String(template?.id),
        value: String(template?.id),
        note: "",
      }),
    });
  }

  // ───────────────────────────── Notes ─────────────────────────────

  // Maps a friendly target type to its API path segment.
  #noteTargetPath(targetType) {
    return {
      Candidate: "candidates",
      Job: "offers",
      "Talent Pool": "talent_pools",
      Requisition: "requisitions",
    }[targetType];
  }

  /**
   * @operationName Add Candidate Note
   * @category Notes & Tasks
   * @description Adds a note to a candidate's profile. Notes are great for interview feedback, reminders, or context for your team.
   *
   * @route POST /add-candidate-note
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to add the note to."}
   * @paramDef {"type":"String","label":"Note","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note text."}
   * @paramDef {"type":"String","label":"Who can see it","name":"visibility","description":"Optional. Leave empty for the default (visible to your team)."}
   *
   * @returns {Object}
   * @sampleResult {"id":7788,"candidate_id":12345,"body":"Strong interview, move forward.","created_at":"2025-01-20T10:00:00.000Z"}
   */
  async addCandidateNote(candidateId, body, visibility) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!body) {
      throw new Error('"Note" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}/notes`,
      method: "post",
      body: { note: cleanupObject({ body, visibility }) },
      logTag: "addCandidateNote",
    });

    return data?.note || data;
  }

  /**
   * @operationName List Candidate Notes
   * @category Notes & Tasks
   * @description Lists the notes saved on a candidate's profile.
   *
   * @route POST /list-candidate-notes
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate whose notes to list."}
   *
   * @returns {Object}
   * @sampleResult {"notes":[{"id":7788,"body":"Strong interview.","created_at":"2025-01-20T10:00:00.000Z"}]}
   */
  async listCandidateNotes(candidateId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/candidates/${candidateId}/notes`,
      logTag: "listCandidateNotes",
    });

    return { notes: firstArray(data, ["notes"]) };
  }

  /**
   * @operationName Add Note
   * @category Notes & Tasks
   * @description Adds a note to a candidate, job, talent pool, or requisition. For candidates, "Add Candidate Note" offers a handy candidate picker.
   *
   * @route POST /add-note
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Attach to","name":"targetType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Candidate","Job","Talent Pool","Requisition"]}},"description":"What kind of item the note belongs to."}
   * @paramDef {"type":"String","label":"Item ID","name":"targetId","required":true,"description":"The numeric ID of the candidate, job, talent pool, or requisition. Use the matching 'Find' or 'List' action to get it."}
   * @paramDef {"type":"String","label":"Note","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note text."}
   * @paramDef {"type":"String","label":"Who can see it","name":"visibility","description":"Optional. Leave empty for the default."}
   *
   * @returns {Object}
   * @sampleResult {"id":7790,"body":"Budget approved.","created_at":"2025-01-20T10:00:00.000Z"}
   */
  async addNote(targetType, targetId, body, visibility) {
    const path = this.#noteTargetPath(targetType);

    if (!path) {
      throw new Error(
        '"Attach to" must be Candidate, Job, Talent Pool, or Requisition.',
      );
    }

    if (!targetId) {
      throw new Error('"Item ID" is required.');
    }

    if (!body) {
      throw new Error('"Note" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/${path}/${targetId}/notes`,
      method: "post",
      body: { note: cleanupObject({ body, visibility }) },
      logTag: "addNote",
    });

    return data?.note || data;
  }

  /**
   * @operationName Update Note
   * @category Notes & Tasks
   * @description Edits the text of an existing note.
   *
   * @route POST /update-note
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The numeric ID of the note to edit."}
   * @paramDef {"type":"String","label":"Note","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new note text."}
   *
   * @returns {Object}
   * @sampleResult {"id":7788,"body":"Updated note text."}
   */
  async updateNote(noteId, body) {
    if (!noteId) {
      throw new Error('"Note ID" is required.');
    }

    if (!body) {
      throw new Error('"Note" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/notes/${noteId}`,
      method: "patch",
      body: { note: { body } },
      logTag: "updateNote",
    });

    return data?.note || data;
  }

  /**
   * @operationName Pin or Unpin Note
   * @category Notes & Tasks
   * @description Pins a note to the top of a profile, or unpins it.
   *
   * @route POST /pin-note
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The numeric ID of the note."}
   * @paramDef {"type":"Boolean","label":"Pinned","name":"pinned","uiComponent":{"type":"TOGGLE"},"description":"On to pin the note, off to unpin it."}
   *
   * @returns {Object}
   * @sampleResult {"id":7788,"pinned":true}
   */
  async pinNote(noteId, pinned) {
    if (!noteId) {
      throw new Error('"Note ID" is required.');
    }

    const action = pinned === false ? "unpin" : "pin";

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/notes/${noteId}/${action}`,
      method: "patch",
      logTag: "pinNote",
    });

    return { id: noteId, pinned: action === "pin" };
  }

  /**
   * @operationName Delete Note
   * @category Notes & Tasks
   * @description Permanently deletes a note. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-note
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The numeric ID of the note to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"noteId":7788}
   */
  async deleteNote(noteId, confirm) {
    if (!noteId) {
      throw new Error('"Note ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("note", { id: noteId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/notes/${noteId}`,
      method: "delete",
      logTag: "deleteNote",
    });

    return { confirmed: true, deleted: true, noteId };
  }

  // ───────────────────────────── Tasks ─────────────────────────────

  /**
   * @operationName Create Task
   * @category Notes & Tasks
   * @description Creates a to-do task, optionally linked to a candidate and assigned to a team member with a due date.
   *
   * @route POST /create-task
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"What needs to be done, e.g. 'Call candidate'."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional. When the task is due, e.g. 2025-01-25 14:00."}
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","dictionary":"getCandidatesDictionary","description":"Optional. Link the task to this candidate."}
   * @paramDef {"type":"String","label":"Assign To","name":"assigneeId","dictionary":"getAdminsDictionary","description":"Optional. Assign the task to this team member."}
   *
   * @returns {Object}
   * @sampleResult {"id":4501,"title":"Call candidate","due_date":"2025-01-25T14:00:00.000Z","completed":false}
   */
  async createTask(title, dueDate, candidateId, assigneeId) {
    if (!title) {
      throw new Error('"Title" is required.');
    }

    const task = cleanupObject({
      title,
      due_date: dueDate,
      admin_id: assigneeId ? Number(assigneeId) || assigneeId : undefined,
    });

    if (candidateId) {
      task.references = [
        { id: Number(candidateId) || candidateId, type: "Candidate" },
      ];
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tasks`,
      method: "post",
      body: { task },
      logTag: "createTask",
    });

    return data?.task || data;
  }

  /**
   * @operationName List Tasks
   * @category Notes & Tasks
   * @description Lists tasks in your account, optionally only completed or only open ones.
   *
   * @route POST /list-tasks
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Show","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["open","completed","all"]}},"description":"Which tasks to show. Defaults to open."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many tasks per page (default 30)."}
   *
   * @returns {Object}
   * @sampleResult {"tasks":[{"id":4501,"title":"Call candidate","completed":false}]}
   */
  async listTasks(status, page, limit) {
    const scopeMap = { open: "pending", completed: "completed", all: "all" };

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tasks`,
      query: cleanupObject({
        scope: scopeMap[status] || "pending",
        page: Number(page) || 1,
        limit: Number(limit) || DEFAULT_PAGE_SIZE,
      }),
      logTag: "listTasks",
    });

    return { tasks: firstArray(data, ["tasks"]) };
  }

  /**
   * @operationName Get Task
   * @category Notes & Tasks
   * @description Returns the details of one task.
   *
   * @route POST /get-task
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The numeric ID of the task."}
   *
   * @returns {Object}
   * @sampleResult {"id":4501,"title":"Call candidate","completed":false}
   */
  async getTask(taskId) {
    if (!taskId) {
      throw new Error('"Task ID" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tasks/${taskId}`,
      logTag: "getTask",
    });

    return data?.task || data;
  }

  /**
   * @operationName Update Task
   * @category Notes & Tasks
   * @description Updates a task's title, due date, or whether it's completed.
   *
   * @route POST /update-task
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The numeric ID of the task to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New due date."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Mark the task done or not done."}
   *
   * @returns {Object}
   * @sampleResult {"id":4501,"title":"Call candidate today","completed":true}
   */
  async updateTask(taskId, title, dueDate, completed) {
    if (!taskId) {
      throw new Error('"Task ID" is required.');
    }

    const task = cleanupObject({
      title,
      due_date: dueDate,
      completed: typeof completed === "boolean" ? completed : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tasks/${taskId}`,
      method: "patch",
      body: { task },
      logTag: "updateTask",
    });

    return data?.task || data;
  }

  /**
   * @operationName Complete Task
   * @category Notes & Tasks
   * @description Marks a task as done.
   *
   * @route POST /complete-task
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The numeric ID of the task to complete."}
   *
   * @returns {Object}
   * @sampleResult {"id":4501,"completed":true}
   */
  async completeTask(taskId) {
    if (!taskId) {
      throw new Error('"Task ID" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tasks/${taskId}`,
      method: "patch",
      body: { task: { completed: true } },
      logTag: "completeTask",
    });

    return data?.task || { id: taskId, completed: true };
  }

  /**
   * @operationName Delete Task
   * @category Notes & Tasks
   * @description Permanently deletes a task. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-task
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The numeric ID of the task to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"taskId":4501}
   */
  async deleteTask(taskId, confirm) {
    if (!taskId) {
      throw new Error('"Task ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("task", { id: taskId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/tasks/${taskId}`,
      method: "delete",
      logTag: "deleteTask",
    });

    return { confirmed: true, deleted: true, taskId };
  }

  // ───────────────────────────── Activity & custom fields ─────────────────────────────

  /**
   * @operationName List Activity
   * @category Activity
   * @description Shows the recent activity timeline — who did what and when. Narrow it to a single candidate or job, or leave both empty for company-wide activity.
   *
   * @route POST /list-activity
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","dictionary":"getCandidatesDictionary","description":"Optional. Show activity for this candidate only."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","dictionary":"getJobsDictionary","description":"Optional. Show activity for this job only."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many activity items per page (default 30)."}
   *
   * @returns {Object}
   * @sampleResult {"activities":[{"id":99001,"kind":"candidate_moved","created_at":"2025-01-20T10:00:00.000Z"}]}
   */
  async listActivity(candidateId, jobId, page, limit) {
    let url = `${this.#getBaseUrl()}/tracking/activities`;

    if (candidateId) {
      url = `${this.#getBaseUrl()}/tracking/candidates/${candidateId}/activities`;
    } else if (jobId) {
      url = `${this.#getBaseUrl()}/tracking/offers/${jobId}/activities`;
    }

    const data = await this.#apiRequest({
      url,
      query: cleanupObject({
        page: Number(page) || 1,
        limit: Number(limit) || DEFAULT_PAGE_SIZE,
      }),
      logTag: "listActivity",
    });

    return { activities: firstArray(data, ["activities"]) };
  }

  /**
   * @operationName List Custom Field Sets
   * @category Custom Fields
   * @description Lists the custom field sets (groups of extra fields) configured in your account.
   *
   * @route POST /list-fieldsets
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"fieldsets":[{"id":301,"name":"Engineering Screening"}]}
   */
  async listFieldsets() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/custom_fields/fieldsets`,
      logTag: "listFieldsets",
    });

    return { fieldsets: firstArray(data, ["fieldsets"]) };
  }

  /**
   * @operationName Create Custom Field Set
   * @category Custom Fields
   * @description Creates a new custom field set.
   *
   * @route POST /create-fieldset
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the field set, e.g. 'Engineering Screening'."}
   *
   * @returns {Object}
   * @sampleResult {"id":302,"name":"Engineering Screening"}
   */
  async createFieldset(name) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/custom_fields/fieldsets`,
      method: "post",
      body: { fieldset: { name } },
      logTag: "createFieldset",
    });

    return data?.fieldset || data;
  }

  /**
   * @operationName Delete Custom Field Set
   * @category Custom Fields
   * @description Permanently deletes a custom field set. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-fieldset
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Field Set ID","name":"fieldsetId","required":true,"description":"The numeric ID of the field set to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"fieldsetId":302}
   */
  async deleteFieldset(fieldsetId, confirm) {
    if (!fieldsetId) {
      throw new Error('"Field Set ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("custom field set", { id: fieldsetId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/custom_fields/fieldsets/${fieldsetId}`,
      method: "delete",
      logTag: "deleteFieldset",
    });

    return { confirmed: true, deleted: true, fieldsetId };
  }

  /**
   * @operationName Set Candidate Custom Field
   * @category Custom Fields
   * @description Sets the value of one custom field on a candidate's profile.
   *
   * @route POST /set-candidate-custom-field
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to update."}
   * @paramDef {"type":"String","label":"Custom Field","name":"fieldId","required":true,"dictionary":"getCustomFieldsDictionary","description":"The custom field to set."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to store in the field."}
   *
   * @returns {Object}
   * @sampleResult {"candidateId":12345,"fieldId":777,"value":"Senior"}
   */
  async setCandidateCustomField(candidateId, fieldId, value) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!fieldId) {
      throw new Error('"Custom Field" is required.');
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/custom_fields/candidates/${candidateId}/fields`,
      method: "post",
      body: { field: { id: Number(fieldId) || fieldId, values: [value] } },
      logTag: "setCandidateCustomField",
    });

    return { candidateId, fieldId, value };
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Fields
   * @description Searchable list of candidate custom fields.
   * @route POST /get-custom-fields-dictionary
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Seniority","value":"777","note":"single_line"}],"cursor":null}
   */
  async getCustomFieldsDictionary(payload) {
    const { search } = payload || {};

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/custom_fields/fields/searchable`,
      logTag: "getCustomFieldsDictionary",
    });

    const fields = firstArray(data, ["fields", "custom_fields"]);

    return {
      items: toDictItems(
        fields,
        (field) => ({
          label: field?.name || String(field?.id),
          value: String(field?.id),
          note: field?.kind || field?.type || "",
        }),
        search,
      ),
      cursor: null,
    };
  }

  // ───────────────────────────── Interviews & evaluations ─────────────────────────────

  /**
   * @operationName Schedule Interview
   * @category Interviews
   * @description Schedules an interview for a candidate at a chosen time. Turn on "Notify participants" to email the candidate and interviewers an invitation.
   *
   * @route POST /schedule-interview
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to interview."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Interview title, e.g. 'Technical Interview'."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the interview starts, e.g. 2025-01-25 14:00."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the interview ends."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","dictionary":"getJobsDictionary","description":"Optional. The job this interview is for."}
   * @paramDef {"type":"String","label":"Location or Link","name":"location","description":"Optional. Where the interview happens (an address or a video call link)."}
   * @paramDef {"type":"Boolean","label":"Notify participants","name":"notifyParticipants","uiComponent":{"type":"TOGGLE"},"description":"When on, the candidate and interviewers get an email invitation."}
   *
   * @returns {Object}
   * @sampleResult {"id":66001,"title":"Technical Interview","start_at":"2025-01-25T14:00:00.000Z","scheduled":true}
   */
  async scheduleInterview(
    candidateId,
    title,
    startTime,
    endTime,
    jobId,
    location,
    notifyParticipants,
  ) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!title) {
      throw new Error('"Title" is required.');
    }

    if (!startTime) {
      throw new Error('"Start Time" is required.');
    }

    const event = cleanupObject({
      title,
      start_at: startTime,
      end_at: endTime,
      where: location,
      offer_id: jobId ? Number(jobId) || jobId : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/candidates/${candidateId}/events`,
      method: "post",
      body: { event },
      logTag: "scheduleInterview",
    });

    const created = data?.event || data;
    let scheduled = false;

    if (notifyParticipants && created && created.id) {
      try {
        await this.#apiRequest({
          url: `${this.#getBaseUrl()}/interview/events/${created.id}/schedule`,
          method: "post",
          logTag: "scheduleInterview",
        });

        scheduled = true;
      } catch (error) {
        logger.warn(`scheduleInterview - notify step failed: ${error.message}`);
      }
    }

    return { ...created, scheduled };
  }

  /**
   * @operationName List Interviews
   * @category Interviews
   * @description Lists scheduled interview events, optionally for one candidate or within a date range.
   *
   * @route POST /list-interviews
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","dictionary":"getCandidatesDictionary","description":"Optional. Only interviews for this candidate."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional. Only interviews on or after this date, e.g. 2025-01-20."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional. Only interviews on or before this date."}
   *
   * @returns {Object}
   * @sampleResult {"interviews":[{"id":66001,"title":"Technical Interview","start_at":"2025-01-25T14:00:00.000Z"}]}
   */
  async listInterviews(candidateId, fromDate, toDate) {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/events`,
      query: cleanupObject({
        candidate_id: candidateId
          ? Number(candidateId) || candidateId
          : undefined,
        date_from: fromDate,
        date_to: toDate,
      }),
      logTag: "listInterviews",
    });

    return { interviews: firstArray(data, ["events"]) };
  }

  /**
   * @operationName Get Interview
   * @category Interviews
   * @description Returns the details of one interview event.
   *
   * @route POST /get-interview
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Interview ID","name":"eventId","required":true,"description":"The numeric ID of the interview event."}
   *
   * @returns {Object}
   * @sampleResult {"id":66001,"title":"Technical Interview","start_at":"2025-01-25T14:00:00.000Z"}
   */
  async getInterview(eventId) {
    if (!eventId) {
      throw new Error('"Interview ID" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/events/${eventId}`,
      logTag: "getInterview",
    });

    return data?.event || data;
  }

  /**
   * @operationName Update Interview
   * @category Interviews
   * @description Updates an interview's title, time, or location.
   *
   * @route POST /update-interview
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Interview ID","name":"eventId","required":true,"description":"The numeric ID of the interview event."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New end time."}
   * @paramDef {"type":"String","label":"Location or Link","name":"location","description":"New location or video link."}
   *
   * @returns {Object}
   * @sampleResult {"id":66001,"title":"Technical Interview (rescheduled)"}
   */
  async updateInterview(eventId, title, startTime, endTime, location) {
    if (!eventId) {
      throw new Error('"Interview ID" is required.');
    }

    const event = cleanupObject({
      title,
      start_at: startTime,
      end_at: endTime,
      where: location,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/events/${eventId}`,
      method: "patch",
      body: { event },
      logTag: "updateInterview",
    });

    return data?.event || data;
  }

  /**
   * @operationName Cancel Interview
   * @category Interviews
   * @description Cancels (deletes) an interview event and notifies the candidate. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /cancel-interview
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Interview ID","name":"eventId","required":true,"description":"The numeric ID of the interview event to cancel."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to cancel the interview — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"cancelled":true,"eventId":66001}
   */
  async cancelInterview(eventId, confirm) {
    if (!eventId) {
      throw new Error('"Interview ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("interview", { id: eventId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/events/${eventId}`,
      method: "delete",
      logTag: "cancelInterview",
    });

    return { confirmed: true, cancelled: true, eventId };
  }

  /**
   * @operationName Submit Scorecard
   * @category Interviews
   * @description Records interview feedback (a scorecard) for a candidate, including an overall rating and comments.
   *
   * @route POST /submit-scorecard
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate the feedback is about."}
   * @paramDef {"type":"String","label":"Overall Rating","name":"rating","uiComponent":{"type":"DROPDOWN","options":{"values":["1","2","3","4","5"]}},"description":"Overall rating from 1 (poor) to 5 (excellent)."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Written feedback about the interview."}
   * @paramDef {"type":"String","label":"Job","name":"jobId","dictionary":"getJobsDictionary","description":"Optional. The job this feedback relates to."}
   *
   * @returns {Object}
   * @sampleResult {"id":71001,"candidate_id":12345,"rating":4}
   */
  async submitScorecard(candidateId, rating, comment, jobId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const result = cleanupObject({
      rating: rating ? Number(rating) || rating : undefined,
      comment,
      offer_id: jobId ? Number(jobId) || jobId : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/candidates/${candidateId}/results`,
      method: "post",
      body: { result },
      logTag: "submitScorecard",
    });

    return data?.result || data;
  }

  /**
   * @operationName List Scorecards
   * @category Interviews
   * @description Lists the interview feedback (scorecards) recorded for a candidate.
   *
   * @route POST /list-scorecards
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate whose feedback to list."}
   *
   * @returns {Object}
   * @sampleResult {"scorecards":[{"id":71001,"rating":4,"comment":"Strong technically."}]}
   */
  async listScorecards(candidateId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/candidates/${candidateId}/results/scorecards`,
      logTag: "listScorecards",
    });

    return { scorecards: firstArray(data, ["scorecards", "results"]) };
  }

  /**
   * @operationName Request Interview Feedback
   * @category Interviews
   * @description Asks one or more team members to leave interview feedback for a candidate.
   *
   * @route POST /request-interview-feedback
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate the feedback is about."}
   * @paramDef {"type":"Array","label":"Reviewers","name":"reviewerIds","required":true,"dictionary":"getAdminsDictionary","description":"One or more team members to ask for feedback."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message to include in the request."}
   *
   * @returns {Object}
   * @sampleResult {"candidateId":12345,"requestedFrom":[111,112]}
   */
  async requestInterviewFeedback(candidateId, reviewerIds, message) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const reviewers = toArray(reviewerIds).map((id) => Number(id) || id);

    if (!reviewers.length) {
      throw new Error('"Reviewers" is required.');
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/candidates/${candidateId}/result_requests`,
      method: "post",
      body: {
        result_request: cleanupObject({ admin_ids: reviewers, message }),
      },
      logTag: "requestInterviewFeedback",
    });

    return { candidateId, requestedFrom: reviewers };
  }

  /**
   * @operationName List Interview Templates
   * @category Interviews
   * @description Lists the reusable interview templates (question sets / scorecards) in your account.
   *
   * @route POST /list-interview-templates
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"interviewTemplates":[{"id":501,"name":"Technical Screen"}]}
   */
  async listInterviewTemplates() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/templates`,
      logTag: "listInterviewTemplates",
    });

    return {
      interviewTemplates: firstArray(data, [
        "templates",
        "interview_templates",
      ]),
    };
  }

  /**
   * @operationName Create Interview Template
   * @category Interviews
   * @description Creates a new interview template.
   *
   * @route POST /create-interview-template
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the template, e.g. 'Technical Screen'."}
   *
   * @returns {Object}
   * @sampleResult {"id":502,"name":"Technical Screen"}
   */
  async createInterviewTemplate(name) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/templates`,
      method: "post",
      body: { template: { name } },
      logTag: "createInterviewTemplate",
    });

    return data?.template || data;
  }

  /**
   * @operationName Delete Interview Template
   * @category Interviews
   * @description Permanently deletes an interview template. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-interview-template
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Interview Template","name":"templateId","required":true,"dictionary":"getInterviewTemplatesDictionary","description":"The template to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"templateId":502}
   */
  async deleteInterviewTemplate(templateId, confirm) {
    if (!templateId) {
      throw new Error('"Interview Template" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("interview template", { id: templateId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/templates/${templateId}`,
      method: "delete",
      logTag: "deleteInterviewTemplate",
    });

    return { confirmed: true, deleted: true, templateId };
  }

  /**
   * @operationName List Interview Availability Schedules
   * @category Interviews
   * @description Lists your self-scheduling templates that let candidates pick an interview slot themselves.
   *
   * @route POST /list-interview-schedules
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"schedules":[{"id":801,"name":"30-min screen"}]}
   */
  async listInterviewSchedules() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/schedules`,
      logTag: "listInterviewSchedules",
    });

    return { schedules: firstArray(data, ["schedules"]) };
  }

  /**
   * @operationName List Meeting Rooms
   * @category Interviews
   * @description Lists the meeting rooms available for booking interviews.
   *
   * @route POST /list-meeting-rooms
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"meetingRooms":[{"id":901,"name":"Room A"}]}
   */
  async listMeetingRooms() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/meeting_rooms`,
      logTag: "listMeetingRooms",
    });

    return { meetingRooms: firstArray(data, ["meeting_rooms"]) };
  }

  /**
   * @operationName List Calendars
   * @category Interviews
   * @description Lists the connected calendars used for scheduling interviews.
   *
   * @route POST /list-calendars
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"calendars":[{"id":1001,"name":"jane@example.com"}]}
   */
  async listCalendars() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/interview/calendars`,
      logTag: "listCalendars",
    });

    return { calendars: firstArray(data, ["calendars"]) };
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Interview Templates
   * @description Searchable list of interview templates.
   * @route POST /get-interview-templates-dictionary
   * @paramDef {"type":"getInterviewTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Technical Screen","value":"501","note":""}],"cursor":null}
   */
  async getInterviewTemplatesDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/interview/templates`,
      keys: ["templates", "interview_templates"],
      search,
      cursor,
      logTag: "getInterviewTemplatesDictionary",
      mapFn: (template) => ({
        label: template?.name || String(template?.id),
        value: String(template?.id),
        note: "",
      }),
    });
  }

  // ───────────────────────────── Communication ─────────────────────────────

  // Maps a friendly email template type to its API path segment.
  #emailTemplatePath(type) {
    return (
      {
        Message: "email_templates",
        "Event Invitation": "event_invitation_templates",
        "Auto-reply": "auto_reply_templates",
      }[type] || "email_templates"
    );
  }

  /**
   * @operationName Send Email to Candidate
   * @category Communication
   * @description Sends an email to a candidate. You can write the message yourself or start from a saved template.
   *
   * @route POST /send-email
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to email."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The email subject line."}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The email body. Can include simple HTML."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","dictionary":"getEmailTemplatesDictionary","description":"Optional. A saved email template to base the message on."}
   *
   * @returns {Object}
   * @sampleResult {"id":88001,"candidate_id":12345,"subject":"Next steps","state":"sent"}
   */
  async sendEmail(candidateId, subject, body, templateId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!subject) {
      throw new Error('"Subject" is required.');
    }

    if (!body) {
      throw new Error('"Message" is required.');
    }

    const message = cleanupObject({
      candidate_id: Number(candidateId) || candidateId,
      subject,
      body,
      email_template_id: templateId
        ? Number(templateId) || templateId
        : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/mailbox/send`,
      method: "post",
      body: message,
      logTag: "sendEmail",
    });

    return data?.message || data;
  }

  /**
   * @operationName Schedule Email to Candidate
   * @category Communication
   * @description Schedules an email to be sent to a candidate at a future time.
   *
   * @route POST /schedule-email
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to email."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The email subject line."}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The email body."}
   * @paramDef {"type":"String","label":"Send At","name":"sendAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When to send the email, e.g. 2025-01-26 09:00."}
   *
   * @returns {Object}
   * @sampleResult {"id":88002,"candidate_id":12345,"state":"scheduled","send_at":"2025-01-26T09:00:00.000Z"}
   */
  async scheduleEmail(candidateId, subject, body, sendAt) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!subject) {
      throw new Error('"Subject" is required.');
    }

    if (!body) {
      throw new Error('"Message" is required.');
    }

    if (!sendAt) {
      throw new Error('"Send At" is required.');
    }

    const message = {
      candidate_id: Number(candidateId) || candidateId,
      subject,
      body,
      send_at: sendAt,
    };

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/mailbox/schedule`,
      method: "post",
      body: message,
      logTag: "scheduleEmail",
    });

    return data?.message || data;
  }

  /**
   * @operationName List Candidate Emails
   * @category Communication
   * @description Lists the email conversations with a candidate.
   *
   * @route POST /list-email-threads
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate whose emails to list."}
   *
   * @returns {Object}
   * @sampleResult {"threads":[{"id":90001,"subject":"Application received","messages_count":2}]}
   */
  async listEmailThreads(candidateId) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/mailbox/candidate/${candidateId}`,
      logTag: "listEmailThreads",
    });

    return { threads: firstArray(data, ["threads"]) };
  }

  /**
   * @operationName Get Email Thread
   * @category Communication
   * @description Returns one email conversation with its messages.
   *
   * @route POST /get-email-thread
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The numeric ID of the email thread."}
   *
   * @returns {Object}
   * @sampleResult {"id":90001,"subject":"Application received","messages":[{"id":1,"body":"Hi..."}]}
   */
  async getEmailThread(threadId) {
    if (!threadId) {
      throw new Error('"Thread ID" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/mailbox/threads/${threadId}`,
      logTag: "getEmailThread",
    });

    return data?.thread || data;
  }

  /**
   * @operationName List Email Templates
   * @category Communication
   * @description Lists your saved email templates of a chosen type.
   *
   * @route POST /list-email-templates
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Message","Event Invitation","Auto-reply"]}},"description":"Which kind of template to list. Defaults to Message."}
   *
   * @returns {Object}
   * @sampleResult {"templates":[{"id":12,"name":"Rejection - polite"}]}
   */
  async listEmailTemplates(type) {
    const path = this.#emailTemplatePath(type);

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/${path}`,
      logTag: "listEmailTemplates",
    });

    return {
      templates: firstArray(data, [path, "email_templates", "templates"]),
    };
  }

  /**
   * @operationName Create Email Template
   * @category Communication
   * @description Creates a new saved email template.
   *
   * @route POST /create-email-template
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Message","Event Invitation","Auto-reply"]}},"description":"Which kind of template to create. Defaults to Message."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the template, e.g. 'Interview Invite'."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The default subject line for emails using this template."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The template body text."}
   *
   * @returns {Object}
   * @sampleResult {"id":13,"name":"Interview Invite"}
   */
  async createEmailTemplate(type, name, subject, body) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    if (!body) {
      throw new Error('"Body" is required.');
    }

    const path = this.#emailTemplatePath(type);

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/${path}`,
      method: "post",
      body: { email_template: cleanupObject({ name, subject, body }) },
      logTag: "createEmailTemplate",
    });

    return data?.email_template || data;
  }

  /**
   * @operationName Delete Email Template
   * @category Communication
   * @description Permanently deletes a saved email template. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-email-template
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Message","Event Invitation","Auto-reply"]}},"description":"Which kind of template to delete. Defaults to Message."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"description":"The numeric ID of the template to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"templateId":13}
   */
  async deleteEmailTemplate(type, templateId, confirm) {
    if (!templateId) {
      throw new Error('"Template ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("email template", {
        id: templateId,
        type: type || "Message",
      });
    }

    const path = this.#emailTemplatePath(type);

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/${path}/${templateId}`,
      method: "delete",
      logTag: "deleteEmailTemplate",
    });

    return { confirmed: true, deleted: true, templateId };
  }

  /**
   * @operationName Send Text Message (SMS)
   * @category Communication
   * @description Sends an SMS text message to a candidate (requires texting to be enabled in your Recruitee account).
   *
   * @route POST /send-sms
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"getCandidatesDictionary","description":"The candidate to text."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text message to send."}
   *
   * @returns {Object}
   * @sampleResult {"id":95001,"candidate_id":12345,"state":"sent"}
   */
  async sendSms(candidateId, message) {
    if (!candidateId) {
      throw new Error('"Candidate" is required.');
    }

    if (!message) {
      throw new Error('"Message" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/texting/messages`,
      method: "post",
      body: {
        message: {
          candidate_id: Number(candidateId) || candidateId,
          body: message,
        },
      },
      logTag: "sendSms",
    });

    return data?.message || data;
  }

  /**
   * @operationName List Text Messages (SMS)
   * @category Communication
   * @description Lists SMS conversations, optionally for a single candidate.
   *
   * @route POST /list-sms-threads
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","dictionary":"getCandidatesDictionary","description":"Optional. Only conversations with this candidate."}
   *
   * @returns {Object}
   * @sampleResult {"threads":[{"id":96001,"candidate_id":12345,"last_message":"Thanks!"}]}
   */
  async listSmsThreads(candidateId) {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/texting/threads`,
      query: cleanupObject({
        candidate_id: candidateId
          ? Number(candidateId) || candidateId
          : undefined,
      }),
      logTag: "listSmsThreads",
    });

    return { threads: firstArray(data, ["threads"]) };
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Email Templates
   * @description Searchable list of message email templates.
   * @route POST /get-email-templates-dictionary
   * @paramDef {"type":"getEmailTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Rejection - polite","value":"12","note":""}],"cursor":null}
   */
  async getEmailTemplatesDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/email_templates`,
      keys: ["email_templates", "templates"],
      search,
      cursor,
      logTag: "getEmailTemplatesDictionary",
      mapFn: (template) => ({
        label: template?.name || template?.title || String(template?.id),
        value: String(template?.id),
        note: "",
      }),
    });
  }

  // ───────────────────────────── Requisitions ─────────────────────────────

  /**
   * @operationName Find Requisitions
   * @category Requisitions
   * @description Lists hiring requisitions (requests to open a role), optionally filtered by status.
   *
   * @route POST /find-requisitions
   * @appearanceColor #7C5CFC #9B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["pending","approved","rejected","archived"]}},"description":"Optional. Only requisitions with this status."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"Number","label":"Results per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many requisitions per page (default 30)."}
   *
   * @returns {Object}
   * @sampleResult {"requisitions":[{"id":2201,"title":"Backend Engineer","status":"pending"}]}
   */
  async findRequisitions(status, page, limit) {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/requisitions`,
      query: cleanupObject({
        scope: status,
        page: Number(page) || 1,
        limit: Number(limit) || DEFAULT_PAGE_SIZE,
      }),
      logTag: "findRequisitions",
    });

    return { requisitions: firstArray(data, ["requisitions"]) };
  }

  /**
   * @operationName Get Requisition
   * @category Requisitions
   * @description Returns the details of one requisition.
   *
   * @route POST /get-requisition
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Requisition","name":"requisitionId","required":true,"dictionary":"getRequisitionsDictionary","description":"The requisition to look up."}
   *
   * @returns {Object}
   * @sampleResult {"id":2201,"title":"Backend Engineer","status":"pending","openings":2}
   */
  async getRequisition(requisitionId) {
    if (!requisitionId) {
      throw new Error('"Requisition" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/requisitions/${requisitionId}`,
      logTag: "getRequisition",
    });

    return data?.requisition || data;
  }

  /**
   * @operationName Create Requisition
   * @category Requisitions
   * @description Creates a new hiring requisition to request approval to open a role.
   *
   * @route POST /create-requisition
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The role being requested, e.g. 'Backend Engineer'."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Optional department for the role."}
   * @paramDef {"type":"Number","label":"Openings","name":"openings","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many positions to open. Defaults to 1."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"additionalFields","description":"Optional. Any additional requisition fields as a JSON object, merged into the request."}
   *
   * @returns {Object}
   * @sampleResult {"id":2202,"title":"Backend Engineer","status":"pending","openings":2}
   */
  async createRequisition(title, departmentId, openings, additionalFields) {
    if (!title) {
      throw new Error('"Title" is required.');
    }

    const requisition = cleanupObject({
      title,
      department_id: departmentId
        ? Number(departmentId) || departmentId
        : undefined,
      openings: openings ? Number(openings) || openings : undefined,
      ...(additionalFields && typeof additionalFields === "object"
        ? additionalFields
        : {}),
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/requisitions`,
      method: "post",
      body: { requisition },
      logTag: "createRequisition",
    });

    return data?.requisition || data;
  }

  /**
   * @operationName Update Requisition
   * @category Requisitions
   * @description Updates a requisition's title, department, or number of openings.
   *
   * @route POST /update-requisition
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Requisition","name":"requisitionId","required":true,"dictionary":"getRequisitionsDictionary","description":"The requisition to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"New department."}
   * @paramDef {"type":"Number","label":"Openings","name":"openings","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New number of openings."}
   *
   * @returns {Object}
   * @sampleResult {"id":2202,"title":"Senior Backend Engineer","openings":3}
   */
  async updateRequisition(requisitionId, title, departmentId, openings) {
    if (!requisitionId) {
      throw new Error('"Requisition" is required.');
    }

    const requisition = cleanupObject({
      title,
      department_id: departmentId
        ? Number(departmentId) || departmentId
        : undefined,
      openings: openings ? Number(openings) || openings : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/requisitions/${requisitionId}`,
      method: "patch",
      body: { requisition },
      logTag: "updateRequisition",
    });

    return data?.requisition || data;
  }

  /**
   * @operationName Update Requisition Status
   * @category Requisitions
   * @description Approves, rejects, archives, cancels, or restores a requisition — all in one place.
   *
   * @route POST /update-requisition-status
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Requisition","name":"requisitionId","required":true,"dictionary":"getRequisitionsDictionary","description":"The requisition to update."}
   * @paramDef {"type":"String","label":"New Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["approve","reject","archive","cancel","retrieve"]}},"description":"Approve or reject a pending requisition, archive/restore it, or cancel it."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional comment, e.g. an approval or rejection note."}
   *
   * @returns {Object}
   * @sampleResult {"id":2202,"status":"approved"}
   */
  async updateRequisitionStatus(requisitionId, status, comment) {
    if (!requisitionId) {
      throw new Error('"Requisition" is required.');
    }

    const allowed = ["approve", "reject", "archive", "cancel", "retrieve"];

    if (!allowed.includes(status)) {
      throw new Error(`"New Status" must be one of: ${allowed.join(", ")}.`);
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/requisitions/${requisitionId}/${status}`,
      method: "patch",
      body: comment ? { comment } : undefined,
      logTag: "updateRequisitionStatus",
    });

    return data?.requisition || data || { id: requisitionId, status };
  }

  /**
   * @operationName Delete Requisition
   * @category Requisitions
   * @description Permanently deletes a pending requisition. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-requisition
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Requisition","name":"requisitionId","required":true,"dictionary":"getRequisitionsDictionary","description":"The requisition to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"requisitionId":2202}
   */
  async deleteRequisition(requisitionId, confirm) {
    if (!requisitionId) {
      throw new Error('"Requisition" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("requisition", { id: requisitionId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/requisitions/${requisitionId}`,
      method: "delete",
      logTag: "deleteRequisition",
    });

    return { confirmed: true, deleted: true, requisitionId };
  }

  // ───────────────────────────── Saved searches & imports ─────────────────────────────

  /**
   * @operationName List Saved Searches
   * @category Advanced
   * @description Lists your saved candidate searches (segments).
   *
   * @route POST /list-saved-searches
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"savedSearches":[{"id":3301,"name":"Senior engineers in Berlin"}]}
   */
  async listSavedSearches() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/search/segments`,
      logTag: "listSavedSearches",
    });

    return { savedSearches: firstArray(data, ["segments"]) };
  }

  /**
   * @operationName Create Saved Search
   * @category Advanced
   * @description Saves a candidate search so you can reuse it later.
   *
   * @route POST /create-saved-search
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the saved search, e.g. 'Senior engineers in Berlin'."}
   * @paramDef {"type":"Object","label":"Filters","name":"filters","description":"Optional. The search filters as a JSON object, in the same shape used by candidate search."}
   *
   * @returns {Object}
   * @sampleResult {"id":3302,"name":"Senior engineers in Berlin"}
   */
  async createSavedSearch(name, filters) {
    if (!name) {
      throw new Error('"Name" is required.');
    }

    const segment = cleanupObject({
      name,
      filters: filters && typeof filters === "object" ? filters : undefined,
    });

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/search/segments`,
      method: "post",
      body: { segment },
      logTag: "createSavedSearch",
    });

    return data?.segment || data;
  }

  /**
   * @operationName Delete Saved Search
   * @category Advanced
   * @description Permanently deletes a saved search. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /delete-saved-search
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Saved Search ID","name":"segmentId","required":true,"description":"The numeric ID of the saved search to delete."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to permanently delete — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"deleted":true,"segmentId":3302}
   */
  async deleteSavedSearch(segmentId, confirm) {
    if (!segmentId) {
      throw new Error('"Saved Search ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("saved search", { id: segmentId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/search/segments/${segmentId}`,
      method: "delete",
      logTag: "deleteSavedSearch",
    });

    return { confirmed: true, deleted: true, segmentId };
  }

  /**
   * @operationName List Imports
   * @category Advanced
   * @description Lists candidate import jobs (CSV uploads) and their status.
   *
   * @route POST /list-imports
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @returns {Object}
   * @sampleResult {"imports":[{"id":4401,"state":"finished","candidates_count":25}]}
   */
  async listImports() {
    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/imports`,
      logTag: "listImports",
    });

    return { imports: firstArray(data, ["imports"]) };
  }

  /**
   * @operationName Get Import
   * @category Advanced
   * @description Returns the details and status of one candidate import.
   *
   * @route POST /get-import
   * @appearanceColor #7C5CFC #9B7DFF
   *
   * @paramDef {"type":"String","label":"Import ID","name":"importId","required":true,"description":"The numeric ID of the import."}
   *
   * @returns {Object}
   * @sampleResult {"id":4401,"state":"finished","candidates_count":25}
   */
  async getImport(importId) {
    if (!importId) {
      throw new Error('"Import ID" is required.');
    }

    const data = await this.#apiRequest({
      url: `${this.#getBaseUrl()}/imports/${importId}`,
      logTag: "getImport",
    });

    return data?.import || data;
  }

  /**
   * @operationName Revert Import
   * @category Advanced
   * @description Reverts a candidate import, removing the candidates it added. This cannot be undone. Leave "Confirm" off to preview first.
   *
   * @route POST /revert-import
   * @appearanceColor #FF5C5C #FF8A8A
   *
   * @paramDef {"type":"String","label":"Import ID","name":"importId","required":true,"description":"The numeric ID of the import to revert."}
   * @paramDef {"type":"Boolean","label":"Confirm","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Leave off to preview. Turn on to revert the import and delete its candidates — this cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"confirmed":true,"reverted":true,"importId":4401}
   */
  async revertImport(importId, confirm) {
    if (!importId) {
      throw new Error('"Import ID" is required.');
    }

    if (!confirm) {
      return this.#deletePreview("import", { id: importId });
    }

    await this.#apiRequest({
      url: `${this.#getBaseUrl()}/imports/${importId}/revert`,
      method: "patch",
      logTag: "revertImport",
    });

    return { confirmed: true, reverted: true, importId };
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Requisitions
   * @description Searchable list of requisitions.
   * @route POST /get-requisitions-dictionary
   * @paramDef {"type":"getRequisitionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Backend Engineer","value":"2201","note":"pending"}],"cursor":null}
   */
  async getRequisitionsDictionary(payload) {
    const { search, cursor } = payload || {};

    return this.#fetchDictionary({
      url: `${this.#getBaseUrl()}/requisitions`,
      keys: ["requisitions"],
      search,
      cursor,
      logTag: "getRequisitionsDictionary",
      mapFn: (requisition) => ({
        label:
          requisition?.title || requisition?.name || String(requisition?.id),
        value: String(requisition?.id),
        note: requisition?.status || "",
      }),
    });
  }

  // ───────────────────────────── Triggers (polling) ─────────────────────────────

  /**
   * @operationName On New Candidate
   * @category Triggers
   * @description Runs whenever a new candidate is added to your account. Optionally limit it to a single job or source. Recruitee checks for new candidates on a schedule.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-candidate
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","dictionary":"getJobsDictionary","description":"Optional. Only fire for candidates added to this job."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"Alex Carter","emails":["alex@example.com"],"created_at":"2025-01-20T09:00:00.000Z"}
   */
  async onNewCandidate(invocation) {
    const jobId = invocation?.triggerData?.jobId;
    const { candidates } = await this.searchCandidates(
      "",
      jobId,
      null,
      1,
      DEFAULT_PAGE_SIZE,
      "created_at_desc",
    );

    if (invocation?.learningMode) {
      return { events: candidates.slice(0, 1), state: null };
    }

    const lastSeenId = invocation?.state?.lastSeenId;
    const newestId = candidates[0]?.id ?? lastSeenId ?? null;

    if (lastSeenId === undefined || lastSeenId === null) {
      return { events: [], state: { lastSeenId: newestId } };
    }

    const fresh = [];

    for (const candidate of candidates) {
      if (String(candidate.id) === String(lastSeenId)) {
        break;
      }

      fresh.push(candidate);
    }

    return { events: fresh, state: { lastSeenId: newestId } };
  }

  /**
   * @operationName On New Application
   * @category Triggers
   * @description Runs whenever a new candidate is added to a specific job's pipeline (a new application). Recruitee checks on a schedule.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-application
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job to watch for new applications."}
   *
   * @returns {Object}
   * @sampleResult {"id":55501,"candidate_id":12345,"offer_id":987,"stage_name":"Applied","created_at":"2025-01-20T09:00:00.000Z"}
   */
  async onNewApplication(invocation) {
    const jobId = invocation?.triggerData?.jobId;

    if (!jobId) {
      return { events: [], state: invocation?.state || {} };
    }

    const { placements } = await this.getJobCandidates(
      jobId,
      1,
      DEFAULT_PAGE_SIZE,
    );

    if (invocation?.learningMode) {
      return { events: placements.slice(0, 1), state: null };
    }

    const lastSeenId = Number(invocation?.state?.lastSeenId) || 0;
    const maxId = placements.reduce(
      (max, placement) => Math.max(max, Number(placement.id) || 0),
      lastSeenId,
    );

    if (!invocation?.state) {
      return { events: [], state: { lastSeenId: maxId } };
    }

    const fresh = placements.filter(
      (placement) => (Number(placement.id) || 0) > lastSeenId,
    );

    return { events: fresh, state: { lastSeenId: maxId } };
  }

  /**
   * @operationName On Candidate Moved to Stage
   * @category Triggers
   * @description Runs whenever a candidate enters a chosen stage of a job's pipeline (for example reaching 'Interview'). Recruitee checks on a schedule.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-candidate-moved-to-stage
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The job whose pipeline to watch."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","required":true,"dictionary":"getStagesDictionary","dependsOn":["jobId"],"description":"Fire when a candidate enters this stage."}
   *
   * @returns {Object}
   * @sampleResult {"id":55501,"candidate_id":12345,"offer_id":987,"stage_id":3002,"stage_name":"Interview"}
   */
  async onCandidateMovedToStage(invocation) {
    const jobId = invocation?.triggerData?.jobId;
    const stageId = invocation?.triggerData?.stageId;

    if (!jobId || !stageId) {
      return { events: [], state: invocation?.state || {} };
    }

    const { placements } = await this.getJobCandidates(jobId, 1, 100);
    const targetStage = String(stageId);

    const stageOf = (placement) =>
      String(placement.stage_id ?? placement.stage?.id ?? "");

    if (invocation?.learningMode) {
      const sample =
        placements.find((placement) => stageOf(placement) === targetStage) ||
        placements[0] ||
        {};

      return { events: [sample], state: null };
    }

    const previous = invocation?.state?.stages || {};
    const current = {};
    const events = [];

    for (const placement of placements) {
      const sid = stageOf(placement);

      current[placement.id] = sid;

      if (sid === targetStage && previous[placement.id] !== targetStage) {
        events.push(placement);
      }
    }

    if (!invocation?.state) {
      return { events: [], state: { stages: current } };
    }

    return { events, state: { stages: current } };
  }

  /**
   * @operationName On Status Change
   * @category Triggers
   * @description Runs when a candidate is disqualified or hired, or when a job is published — your choice. Recruitee checks on a schedule.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-status-change
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"When","name":"eventType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Candidate disqualified","Candidate hired","Job published"]}},"description":"Which change to watch for."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"Alex Carter","status":"hired"}
   */
  async onStatusChange(invocation) {
    const eventType = invocation?.triggerData?.eventType;
    let items = [];

    if (eventType === "Job published") {
      items = (await this.listJobs("published", false, 1, DEFAULT_PAGE_SIZE))
        .jobs;
    } else {
      const status = eventType === "Candidate hired" ? "hired" : "disqualified";

      items = (
        await this.searchCandidates(
          "",
          null,
          status,
          1,
          DEFAULT_PAGE_SIZE,
          "created_at_desc",
        )
      ).candidates;
    }

    if (invocation?.learningMode) {
      return { events: items.slice(0, 1), state: null };
    }

    const ids = items.map((item) => String(item.id));

    if (!invocation?.state) {
      return { events: [], state: { seen: ids } };
    }

    const seen = new Set(invocation.state.seen || []);
    const fresh = items.filter((item) => !seen.has(String(item.id)));
    const newSeen = Array.from(new Set([...ids, ...seen])).slice(0, 500);

    return { events: fresh, state: { seen: newSeen } };
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    logger.debug(`handleTriggerPollingForEvent.${invocation?.eventName}`);

    return this[invocation.eventName](invocation);
  }
}

/**
 * @typedef {Object} getRequisitionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter requisitions."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getEmailTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter email templates."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getInterviewTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter interview templates."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getCustomFieldsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter custom fields."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getPipelineTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter pipeline templates."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getJobsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter jobs."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getTalentPoolsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter talent pools."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getCandidatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter candidates."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter tags."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getSourcesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter sources."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getDisqualifyReasonsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter reasons."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getDepartmentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter departments."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getLocationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter locations."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getAdminsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter team members."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 */

/**
 * @typedef {Object} getStagesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"description":"The job whose stages should be listed."}
 */

/**
 * @typedef {Object} getStagesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter stages."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page."}
 * @paramDef {"type":"getStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The job to read stages from."}
 */

Flowrunner.ServerCode.addService(RecruiteeService, [
  {
    name: "apiToken",
    displayName: "API Token",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: "Your Personal API Token from Settings → Apps and plugins → Personal API tokens → + New token.",
  },
  {
    name: "companyId",
    displayName: "Company ID",
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: "Your Company ID (or the subdomain before .recruitee.com). Shown on the same API Tokens settings page.",
  },
]);

module.exports = RecruiteeService;

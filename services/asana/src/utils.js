function similar(s1, s2) {
  return s1.toLowerCase().includes(s2.toLowerCase())
}

function clean(obj) {
  const newObj = {}

  for (const propName in obj) {
    if (obj[propName] !== null && obj[propName] !== undefined) {
      newObj[propName] = obj[propName]
    }
  }

  return newObj
}

const OptionsShaper = {
  base: ({ gid, name }) => ({ label: name || '[empty]', note: `ID: ${ gid }`, value: gid }),
  user: ({ gid, name, email }) => ({ label: name || '[empty]', note: `Email: ${ email }`, value: gid }),
}

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item => props.some(prop => item[prop]?.toLowerCase().includes(caseInsensitiveSearch)))
}

const Normalizer = {
  task: ({
    gid,
    name,
    notes,
    created_at,
    assignee,
    workspace,
    permalink_url,
    modified_at,
    completed,
    due_on,
    start_on,
  }) => ({
    taskId: gid,
    name,
    notes,
    created: created_at,
    dueOn: due_on,
    startOn: start_on,
    completed: completed,
    modified: modified_at,
    taskUrl: permalink_url,
    assigneeName: assignee?.name,
    assigneeId: assignee?.gid,
    workspace: workspace?.name,
    workspaceId: workspace?.gid,
  }),

  project: ({
    gid,
    name,
    notes,
    created_at,
    modified_at,
    completed_at,
    archived,
    permalink_url,
    workspace,
    team,
    owner,
    members,
    followers,
  }) => ({
    projectId: gid,
    name,
    notes,
    createdAt: created_at,
    modifiedAt: modified_at,
    completedAt: completed_at,
    archived,
    projectUrl: permalink_url,
    workspaceName: workspace?.name,
    workspaceId: workspace?.gid,
    teamName: team?.name,
    teamId: team?.gid,
    ownerName: owner?.name,
    ownerId: owner?.gid,
    members: (members || [])?.map(member => member.gid),
    followers: (followers || [])?.map(member => member.gid),
  }),

  section: ({ gid, name, created_at, project }) => ({
    sectionId: gid,
    name,
    createdAt: created_at,
    projectId: project?.gid,
    projectName: project?.name,
  }),
}

module.exports = {
  OptionsShaper,
  similar,
  searchFilter,
  clean,
  Normalizer,
}

'use strict'

const { cleanupObject, searchFilter } = require('./utils')

const API_BASE_URL = 'https://api.pdf.co/v1'

const ImagesMap = {
  JPG: 'jpg',
  PNG: 'png',
  WEBP: 'webp',
  TIFF: 'tiff',
}

const ConvertToMap = {
  CSV: 'csv',
  JSON: 'json2',
  JSON_Meta: 'json-meta',
  Text: 'text',
  Text_Simple: 'text-simple',
  Excel: 'xls',
  ExcelX: 'xlsx',
  XML: 'xml',
  HTML: 'html',
  Image_JPG: 'jpg',
  Image_PNG: 'png',
  Image_WEBP: 'webp',
  Image_TIFF: 'tiff',
}

const ConvertFromMap = {
  Document: 'doc',
  CSV: 'csv',
  Image: 'image',
  URL: 'url',
  HTML: 'html',
  Email: 'email',
}

const logger = {
  info: (...args) => console.log('[PDF.co Service] info:', ...args),
  debug: (...args) => console.log('[PDF.co Service] debug:', ...args),
  error: (...args) => console.log('[PDF.co Service] error:', ...args),
  warn: (...args) => console.log('[PDF.co Service] warn:', ...args),
}

/**
 * @integrationName PDF.co
 * @integrationIcon /icon.svg
 * @description Advanced PDF processing service providing comprehensive document conversion, manipulation, and analysis capabilities through PDF.co's AI-powered API. Features include intelligent invoice parsing, multi-format document conversion (PDF to text/images/Excel/JSON), document merging and splitting, PDF compression and security management, barcode generation and recognition, and automated document classification. Supports both synchronous and asynchronous processing with extensive customization options through profiles and parameters.
 */
class PdfcoService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method, body, logTag }) {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    }

    try {
      body = cleanupObject(body)
      logger.debug(`[${ logTag }] API Request: [${ method.toUpperCase() }::${ url }], body=${ JSON.stringify(body) }`)

      const response = await Flowrunner.Request[method](url).set(headers).send(body)

      logger.debug(`[${ logTag }] API Response: credits=${ response.credits || 'unknown' }`)

      return response
    } catch (error) {
      const errorMessage = error.message || 'Unknown error'
      const statusCode = error.status || error.statusCode || 'unknown'

      logger.error(`[${ logTag }] API Error: ${ errorMessage } (status: ${ statusCode })`)

      // Re-throw with additional context if it's a PDF.co API error
      if (error.body && typeof error.body === 'object') {
        error.message = `PDF.co API Error: ${ errorMessage }`
      }

      throw error
    }
  }

  /**
   * @typedef {Object} getHtmlTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter HTML templates by their type or title. Filtering is performed locally on retrieved results to help find specific templates."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor to retrieve the next page of template results from the PDF.co API. Use this for paginating through large template collections."}
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {String} note
   * @property {String} value
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get HTML Templates Dictionary
   * @description Retrieves a comprehensive list of available HTML templates from PDF.co that can be used for document generation and PDF creation. These templates provide pre-built, professionally designed structures for creating PDFs from HTML content, including invoice templates, report layouts, and custom document formats.
   *
   * @route POST /get-html-templates-dictionary
   *
   * @paramDef {"type":"getHtmlTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search parameters and pagination cursor for retrieving and filtering available HTML templates from your PDF.co account."}
   *
   * @sampleResult {"items":[{"label":"Invoice Template (invoice)","note":"ID: inv_001","value":"inv_001"},{"label":"Report Template (report)","note":"ID: rpt_002","value":"rpt_002"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async getHtmlTemplatesDictionary(payload) {
    const { search } = payload

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/templates/html`,
      method: 'get',
      logTag: 'getHtmlTemplatesDictionary',
    })

    const templates = response.templates || []

    const filteredTemplates = search ? searchFilter(templates, ['type', 'title'], search) : templates

    return {
      cursor: null,
      items: filteredTemplates.map(({ id, title, type }) => ({
        label: `${ title } (${ type })`,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} PdfResponse
   * @property {String} url - Download URL for the processed PDF file
   * @property {Array<String>} urls - Array of download URLs for multiple output files
   * @property {String|Object} body - Response body content for inline results
   * @property {Number} fileSize - Size of the generated file in bytes
   * @property {Number} pageCount - Total number of pages in the processed document
   * @property {Boolean} error - Indicates if the operation encountered an error
   * @property {Number} status - HTTP status code of the operation
   * @property {String} name - Name of the generated output file
   * @property {Number} duration - Processing time in milliseconds
   * @property {Number} remainingCredits - Number of API credits remaining in account
   * @property {Number} credits - Number of credits consumed by this operation
   * @property {String} outputLinkValidTill - Expiration timestamp for output file links
   */

  /**
   * @typedef {Object} PdfsResponse
   * @property {Array<String>} urls - Array of download URLs for generated PDF files
   * @property {Number} pageCount - Total number of pages processed across all documents
   * @property {Boolean} error - Indicates if the operation encountered an error
   * @property {Number} status - HTTP status code of the operation
   * @property {String} name - Base name used for generated output files
   * @property {Number} remainingCredits - Number of API credits remaining in account
   * @property {Number} credits - Number of credits consumed by this operation
   */

  /**
   * @typedef {Object} JobStatusResponse
   * @property {String} status - Current status of the background job (pending, processing, success, error)
   * @property {String} message - Descriptive message about the job status or any errors
   * @property {String} url - Download URL for the completed job result (when status is success)
   * @property {String} jobId - Unique identifier of the background job
   * @property {Number} credits - Number of credits consumed by the completed job
   * @property {Number} remainingCredits - Number of API credits remaining in account
   * @property {Number} duration - Total processing time in milliseconds
   */

  /**
   * @typedef {Object} Barcode
   * @property {String} Value - Decoded barcode value/content
   * @property {Array<Number>} RawData - Raw binary data of the barcode
   * @property {Number} Type - Numeric type identifier of the barcode format
   * @property {String} Rect - Bounding rectangle coordinates where barcode was found
   * @property {Number} Page - Page number where the barcode was detected (0-based)
   * @property {String} File - Source file URL where the barcode was found
   * @property {Number} Confidence - Recognition confidence score (0-1)
   * @property {String} Metadata - Additional metadata about the barcode detection
   * @property {String} TypeName - Human-readable name of the barcode type
   */

  /**
   * @typedef {Object} Barcodes
   * @property {Array<Barcode>} barcodes - Array of detected and decoded barcodes
   * @property {Number} pageCount - Total number of pages scanned for barcodes
   * @property {Boolean} error - Indicates if the barcode reading operation encountered an error
   * @property {Number} status - HTTP status code of the barcode reading operation
   * @property {Number} remainingCredits - Number of API credits remaining in account
   * @property {Number} credits - Number of credits consumed by the barcode reading operation
   */

  /**
   * @description Extracts structured invoice data from PDF documents using PDF.co's advanced AI-powered Invoice Parser. This intelligent system automatically identifies and extracts key invoice information including vendor details, billing addresses, line items, taxes, totals, dates, and invoice numbers without requiring templates or manual configuration. The AI engine is trained on thousands of invoice formats and provides reliable extraction from various invoice layouts and styles.
   *
   * @route POST /parseInvoice
   * @operationName Parse Invoice with AI
   * @category Invoice Processing
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice PDF URL","name":"fileUrl","required":true,"description":"The publicly accessible URL of the invoice PDF document to be analyzed and parsed. The PDF should contain invoice data in a recognizable format for optimal AI extraction results. Supports most standard invoice layouts and formats."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callback","description":"Optional webhook URL where PDF.co will POST the parsing results upon completion. If omitted, the processing will be synchronous and results returned immediately. Use webhooks for asynchronous processing of large or complex invoices to avoid timeouts."}
   *
   * @sampleResult {"error":false,"status":"created","jobId":"7830deca-2e66-11ef-9ad3-8eff830e7461","credits":100,"remainingCredits":106674,"duration":33}
   * @returns {PdfResponse}
   */
  async parseInvoice(fileUrl, callback) {
    logger.debug(`[parseInvoice] Starting AI invoice parsing for URL: ${ fileUrl } with callback: ${ callback }`)

    if (!fileUrl) {
      throw new Error('File URL is required for invoice parsing')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/ai-invoice-parser`,
      method: 'post',
      body: { url: fileUrl, callback },
      logTag: 'parseInvoice',
    })
  }

  /**
   * @description Converts PDF documents to plain text using PDF.co's streamlined text extraction engine. This method provides fast, efficient text extraction optimized for PDFs with selectable text content. Ideal for documents with standard text formatting where OCR capabilities are not required. For scanned documents, advanced text processing, or enhanced extraction features, use the advanced conversion method instead.
   *
   * @route POST /convertPdfToTextSimple
   * @operationName Convert PDF to Text (Basic)
   * @category Text Extraction
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"PDF URL","name":"fileUrl","required":true,"description":"The publicly accessible URL of the PDF document to be converted to plain text. The PDF should contain selectable text content for optimal extraction results."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP basic authentication username if the PDF URL requires authentication credentials to access the document."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP basic authentication password if the PDF URL requires authentication credentials to access the document."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Comma-separated list of page indices or ranges to process (e.g., '0,1,2-5' for pages 1, 2, and 3-6). The first page index is 0. Leave empty to process all pages in the document."}
   * @paramDef {"type":"Boolean","label":"Return Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to true to return the extracted text directly in the response body. If false, returns a downloadable URL link to the generated text file."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password required to open and access the PDF document if it is password-protected or encrypted."}
   * @paramDef {"type":"Boolean","label":"Async Processing","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to true to process the request asynchronously. The API will return a jobId that can be used to check the processing status and retrieve results later."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Custom name for the generated text output file (e.g., 'extracted-text.txt'). If not specified, a default filename will be automatically generated."}
   *
   * @sampleResult {"body":"ItemQuantityPriceTotal\r\nItem1140.0040.00\r\nItem2230.0060.00\r\nItem3320.0060.00\r\nItem4410.0040.00\r\nTOTAL200.00\r\n","pageCount":1,"error":false,"status":200,"name":"sample.txt","remainingCredits":99032333,"credits":21}
   * @returns {PdfResponse}
   */
  async convertPdfToTextSimple(fileUrl, httpUsername, httpPassword, pages, inline, password, async, name) {
    logger.debug(`[convertPdfToTextSimple] Starting basic PDF to text conversion for URL: ${ fileUrl }`)

    if (!fileUrl) {
      throw new Error('File URL is required for PDF text conversion')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/convert/to/text-simple`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        inline,
        password,
        async,
        name,
      },
      logTag: 'convertPdfToTextSimple',
    })
  }

  /**
   * @description Converts PDF documents to text using PDF.co's advanced text extraction engine with comprehensive OCR capabilities, language support, and region-specific extraction. This method provides enhanced text processing for scanned documents, multi-language content, and complex document layouts with precise control over extraction parameters and output formatting.
   *
   * @route POST /convertPdfToTextAdvanced
   * @operationName Convert PDF to Text (Advanced)
   * @category Text Extraction
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"PDF URL","name":"fileUrl","required":true,"description":"The publicly accessible URL of the PDF document to be converted to text using advanced extraction capabilities."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP basic authentication username for accessing the source URL, if authentication is required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP basic authentication password for accessing the source URL, if authentication is required."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Comma-separated list of page indices or ranges to process (e.g., '0,1,2-5' for specific pages). The first page index is 0. Leave empty to process all pages."}
   * @paramDef {"type":"Boolean","label":"Unwrap Lines","name":"unwrap","uiComponent":{"type":"TOGGLE"},"description":"Set to true to unwrap lines into a single continuous line within table cells when line grouping is enabled. Useful for better text flow in extracted content."}
   * @paramDef {"type":"String","label":"Region Coordinates","name":"rect","description":"Defines specific coordinates for text extraction in the format 'x1,y1,x2,y2' (e.g., '100,100,500,400'). Only extracts text from the specified rectangular region."}
   * @paramDef {"type":"String","label":"OCR Language","name":"lang","uiComponent":{"type":"DROPDOWN","options":{"values":["eng","deu","fra","spa","ita","por","rus","chi_sim","chi_tra","jpn","kor","ara","hin","ben","urd","fas","tha","vie","tur","pol","nld","dan","swe","nor","fin","ces","slk","hun","ron","bul","hrv","srp","slv","est","lav","lit","ukr","bel","ell","mkd","aze","kaz","uzb","tgk","kir","msa","ind","tgl","ceb","cym","gle","grc","lat","afr","swa","amh","bod","mya","khm","lao","kan","mal","tam","tel","ori","pan","guj","mar","sin","nep","asm","hat","iku","chr","heb","yid","san"]}},"description":"Language for OCR processing when handling scanned PDFs or images. Default is 'eng' (English). You can specify multiple languages like 'eng+deu' for better recognition accuracy."}
   * @paramDef {"type":"Boolean","label":"Return Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to true to return the extracted text directly in the response body. If false, returns a downloadable URL link to the generated text file."}
   * @paramDef {"type":"String","label":"Line Grouping","name":"lineGrouping","description":"Enable line grouping within table cells by setting to '1'. This helps maintain proper text structure and formatting in extracted content."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password required to open and access the PDF document if it is password-protected or encrypted."}
   * @paramDef {"type":"Boolean","label":"Async Processing","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to true to process the request asynchronously. The API will return a jobId that can be used to check processing status and retrieve results later."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Custom name for the generated text output file (e.g., 'extracted-content.txt'). If not specified, a default filename will be generated."}
   * @paramDef {"type":"Number","label":"Link Expiration (Minutes)","name":"expiration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Expiration time for the output file link in minutes (default: 60). After this time, the generated file will be automatically deleted from temporary storage."}
   *
   * @sampleResult {"body":"ItemQuantityPriceTotal\r\nItem1140.0040.00\r\nItem2230.0060.00\r\nItem3320.0060.00\r\nItem4410.0040.00\r\nTOTAL200.00\r\n","pageCount":1,"error":false,"status":200,"name":"sample.txt","remainingCredits":99032333,"credits":21}
   * @returns {PdfResponse}
   */
  async convertPdfToTextAdvanced(
    fileUrl,
    httpUsername,
    httpPassword,
    pages,
    unwrap,
    rect,
    lang,
    inline,
    lineGrouping,
    password,
    async,
    name,
    expiration
  ) {
    logger.debug(
      `[convertPdfToTextAdvanced] Starting advanced PDF to text conversion for URL: ${ fileUrl } with OCR language: ${ lang }`
    )

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/convert/to/text`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        unwrap,
        rect,
        lang,
        inline,
        lineGrouping,
        password,
        async,
        name,
        expiration,
      },
      logTag: 'convertPdfToTextAdvanced',
    })
  }

  /**
   * @description Converts PDF pages to high-quality images in multiple formats (JPG, PNG, WEBP, TIFF). Each PDF page becomes a separate image file. Supports region extraction, custom resolution settings, and various image optimization options through profiles. Ideal for creating thumbnails, previews, or extracting visual content from PDFs.
   *
   * @route POST /convertPdfToImage
   * @operationName Convert PDF to Images
   * @category Image Conversion
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"PDF URL","name":"fileUrl","required":true,"description":"The publicly accessible URL of the PDF document to convert to images. Each page will be converted to a separate image file."}
   * @paramDef {"type":"String","label":"Image Format","name":"imageFormat","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["JPG","PNG","WEBP","TIFF"]}},"description":"The desired output image format. JPG offers smallest file size, PNG provides transparency support, WEBP offers modern compression, TIFF provides highest quality."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username if the PDF URL requires basic authentication to access the document."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password if the PDF URL requires basic authentication to access the document."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Comma-separated list of page indices or ranges to convert (e.g., '0,1,2-5' for pages 1, 2, and 3-6). The first page index is 0. Leave empty to convert all pages."}
   * @paramDef {"type":"String","label":"Region Coordinates","name":"rect","description":"Extract only a specific region from each page using coordinates in format 'x1,y1,x2,y2' (e.g., '100,100,500,400'). Coordinates are in points from the top-left corner."}
   * @paramDef {"type":"Boolean","label":"Return Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to true to return image data directly in the response (base64 encoded). If false, returns URLs to download the image files."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password required to open the PDF document if it is password-protected."}
   * @paramDef {"type":"Boolean","label":"Async Processing","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to true to process the request asynchronously. The API will return a jobId that can be used to check the processing status and retrieve results later."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Base name for the generated image files (e.g., 'page-image'). Page numbers will be appended automatically (page-image-1.png, page-image-2.png, etc.)."}
   * @paramDef {"type":"Number","label":"Link Expiration (Minutes)","name":"expiration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Expiration time for the output image links in minutes (default: 60). After this time, the image files will be automatically deleted from temporary storage."}
   * @paramDef {"type":"String","label":"Image Profiles (JSON)","name":"profiles","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with advanced image optimization settings. Example: '{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":85,\"ResampleImages\":true,\"ResamplingResolution\":150}'. See PDF.co Profiles documentation for all available options."}
   *
   * @sampleResult {"urls":["https://pdf-temp-files.s3.amazonaws.com/c15b8d82e0034d01a73eac719d69349b/sample.png","https://pdf-temp-files.s3.amazonaws.com/152d2fe414b645e38f81a49e5dafa85b/sample.png"],"pageCount":2,"error":false,"status":200,"name":"sample.png","duration":1121,"remainingCredits":98722216,"credits":30}
   * @returns {PdfsResponse}
   */
  async convertPdfToImage(
    fileUrl,
    imageFormat,
    httpUsername,
    httpPassword,
    pages,
    rect,
    inline,
    password,
    async,
    name,
    expiration,
    profiles
  ) {
    logger.debug(`[convertPdfToImage] Starting conversion to ${ imageFormat } for URL: ${ fileUrl }`)

    const format = ImagesMap[imageFormat]

    if (!format) {
      throw new Error(`Unsupported image format: ${ imageFormat }`)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/convert/to/${ format }`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        rect,
        inline,
        password,
        async,
        name,
        expiration,
        profiles,
      },
      logTag: 'convertPdfToImage',
    })
  }

  /**
   * @description Combines multiple PDF documents into a single unified PDF file with precise control over document order and optimization settings. Documents are merged sequentially, preserving the original page structure and content while allowing for compression and quality optimization. This standard merge operation is optimized for PDF files exclusively and maintains document integrity throughout the process.
   *
   * @route POST /mergePdfs
   * @operationName Merge PDF Documents
   * @category Document Merging
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array","label":"PDF URLs","name":"pdfUrls","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of publicly accessible URLs pointing to the PDF documents to be merged. Documents will be combined in the exact order specified in this array. Each URL should be on a separate line or provided as a JSON array."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP basic authentication username if any of the PDF URLs require authentication credentials to access the documents."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP basic authentication password if any of the PDF URLs require authentication credentials to access the documents."}
   * @paramDef {"type":"Boolean","label":"Async Processing","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to true to process the merge operation asynchronously. The API will return a jobId that can be used to monitor processing status and retrieve the merged PDF later using the job status endpoint."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Custom name for the merged PDF output file (e.g., 'combined-report.pdf'). If not specified, a default filename will be automatically generated based on the current timestamp."}
   * @paramDef {"type":"Number","label":"Link Expiration (Minutes)","name":"expiration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Expiration time for the output PDF download link in minutes (default: 60). After this time, the merged PDF will be automatically deleted from temporary storage to save space."}
   * @paramDef {"type":"String","label":"PDF Profiles (JSON)","name":"profiles","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with advanced PDF optimization and compression settings. Example: '{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":75,\"CompressImages\":true}'. Refer to PDF.co Profiles documentation for complete options list."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.amazonaws.com/c15b8d82e0034d01a73eac719d69349b/result.pdf","error":false,"status":200,"name":"result.pdf","remainingCredits":98722216,"credits":5}
   * @returns {PdfResponse}
   */
  async mergePdfs(pdfUrls, httpUsername, httpPassword, async, name, expiration, profiles) {
    logger.debug(`[mergePdfs] Starting PDF merge operation for ${ pdfUrls?.length || 0 } documents`)

    if (!pdfUrls || pdfUrls.length === 0) {
      throw new Error('At least one PDF URL is required for merging')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/merge`,
      method: 'post',
      body: {
        url: pdfUrls.map(u => u.trim()).join(','),
        httpusername: httpUsername,
        httppassword: httpPassword,
        async,
        name,
        expiration,
        profiles,
      },
      logTag: 'mergePdfs',
    })
  }

  /**
   * @description Merges multiple documents (PDF, Word, Excel, images, or ZIP) into a single PDF using PDF.co's advanced merge endpoint.
   *
   * @route POST /mergeDocumentsAdvanced
   * @operationName Merge Documents (Multi-Type)
   * @category Document Merging
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array","label":"File URLs","name":"fileUrls","required":true,"description":"A list of document URLs to be merged. Supported formats include **PDF**, **Word**, **Excel**, **images**, and **ZIP archives**. All files will be combined into a single PDF."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Sets a custom name for the resulting merged PDF file (e.g., `final-report.pdf`)."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is 60, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.amazonaws.com/3ec287356c0b4e02b5231354f94086f2/result.pdf","error":false,"status":200,"name":"result.pdf","remainingCredits":98465}
   * @returns {PdfResponse}
   */
  async mergeDocumentsAdvanced(fileUrls, httpUsername, httpPassword, name, expiration, profiles) {
    logger.debug(`[mergeDocumentsAdvanced] Starting advanced merge for ${ fileUrls.length } files`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/merge2`,
      method: 'post',
      body: {
        url: fileUrls.map(u => u.trim()).join(','),
        httpusername: httpUsername,
        httppassword: httpPassword,
        name,
        expiration,
        profiles,
      },
      logTag: 'mergeDocumentsAdvanced',
    })
  }

  /**
   * @description Splits a PDF into multiple PDF files using page indexes or page ranges.
   *
   * @route POST /splitPdf
   * @operationName Split PDF
   * @category Document Splitting
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Comma-separated list of page indices or ranges to process (e.g., `1,2,3-`). The first page index is `1`."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password for the PDF file, if it's protected."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"Boolean","label":"Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to true to return results directly in the response. Otherwise, the endpoint will return a link to the output file generated."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"File name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"urls":["https://pdf-temp-files.s3.amazonaws.com/1e9a7f2c46834160903276716424382b/result_page1-2.pdf","https://pdf-temp-files.s3.amazonaws.com/c976b9f89a2e460786a3d5c0deeeef67/result_page3-4.pdf"],"pageCount":4,"error":false,"status":200,"name":"result.pdf","remainingCredits":98441}
   * @returns {PdfsResponse}
   */
  async splitPdf(fileUrl, httpUsername, httpPassword, pages, password, async, inline, name, expiration, profiles) {
    logger.debug(`[splitPdf] Starting PDF split for a file: ${ fileUrl }`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/split`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        password,
        async,
        inline,
        name,
        expiration,
        profiles,
      },
      logTag: 'splitPdf',
    })
  }

  /**
   * @description Deletes selected pages inside a PDF file.
   *
   * @route POST /deletePdfPages
   * @operationName Delete PDF Pages
   * @category Document Editing
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","required":true,"description":"Comma-separated list of page indices or ranges to process (e.g., `1,2,3-`). The first page index is `1`."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"File name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.amazonaws.com/d15e5b2c89c04484ae6ac7244ac43ac2/result.pdf","pageCount":2,"error":false,"status":200,"name":"result.pdf","remainingCredits":60100}
   * @returns {PdfResponse}
   */
  async deletePdfPages(fileUrl, httpUsername, httpPassword, pages, name, expiration, async, profiles) {
    logger.debug(`[deletePdfPages] Starting PDF page deletion for: ${ fileUrl }`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/edit/delete-pages`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        name,
        expiration,
        async,
        profiles,
      },
      logTag: 'deletePdfPages',
    })
  }

  /**
   * @description Automatically finds class of input PDF, JPG, PNG document by analyzing its content using the built-in AI or custom defined classification rules.
   *
   * @route POST /classifyPdf
   * @operationName Classify PDF
   * @category Document Analysis
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Rules CSV","name":"rulesCsv","description":"Define custom classification rules in CSV format. Each row should include: class name, logic (AND/OR), and keywords separated by commas. Rows are separated by \\n. Keywords can include regular expressions using /pattern/ or /pattern/i. Escape backslashes for JSON (e.g., \\d -> \\\\\\\\d)."}
   * @paramDef {"type":"String","label":"Rules CSV URL","name":"rulesCsvUrl","description":"Instead of inline CSV you can use this parameter and set the URL to a CSV file with classification rules. This is useful if you have a separate developer working on CSV rules."}
   * @paramDef {"type":"Boolean","label":"Case Sensitive","name":"caseSensitive","uiComponent":{"type":"TOGGLE"},"description":"Defines if keywords in rules are case-sensitive or not. Default: true."}
   * @paramDef {"type":"Boolean","label":"Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to true to return results inside the response. Otherwise, the endpoint will return a link to the output file generated."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password for the PDF file, if it's protected."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"File name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"body":{"classes":[{"class":"invoice"},{"class":"finance"},{"class":"documents"}]},"pageCount":1,"error":false,"status":200,"credits":42,"duration":353,"remainingCredits":98019328}
   * @returns {PdfResponse}
   */
  async classifyPdf(
    fileUrl,
    httpUsername,
    httpPassword,
    rulesCsv,
    rulesCsvUrl,
    caseSensitive,
    inline,
    password,
    async,
    name,
    expiration,
    profiles
  ) {
    logger.debug(`[classifyPdf] Starting PDF classification for: ${ fileUrl }`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/classifier`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        rulescsv: rulesCsv,
        rulescsvurl: rulesCsvUrl,
        caseSensitive,
        inline,
        password,
        async,
        name,
        expiration,
        profiles,
      },
      logTag: 'classifyPdf',
    })
  }

  /**
   * @description Optimizes input PDF files up to 13 times smaller in file size by optimizing images and objects inside.
   *
   * @route POST /compressPdf
   * @operationName Compress PDF
   * @category PDF Optimization
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"File name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password for the PDF file, if it's protected."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.us-west-2.amazonaws.com/TEPHYOOWTKN47RSMF11CXHXHD7U68ZSS/sample-compressed.pdf?X-Amz-Expires=3600&X-Amz-Security-Token=FwoGZXIvYXdzEEsaDMAT9Cnzd6%2FnDfVKYSKCAU6XCvsgWTRfJHWmoO2iJfJ6YSVShb6ddOXU9Ks5G4Ai20O2idqOaLLslwt6uEnT9EbwpzBMEXuqREkoTTmUOEcXJi9zO5lkLoQ16tXCbfmUF8cvJxVYBXGRHJlzHQ20kJtN6lP237e8rlMtNRIK0f1QsIQswfWy2BFz8IuOndZRu8goquiLmQYyKBBjAmoWcEqs0iMA7MizFAdIbFGydTYXcptaixm%2F%2BfayUZKUByJHURU%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA4NRRSZPHNTO33MZG/20220915/us-west-2/s3/aws4_request&X-Amz-Date=20220915T135207Z&X-Amz-SignedHeaders=host&X-Amz-Signature=4f3334f68f1a98d3a9bfe09ec03d3e7d10fb7709ce58b711e36652c59a4d6b4a","fileSize":798621,"pageCount":5,"error":false,"status":200,"name":"sample-compressed.pdf","credits":105,"duration":2886,"remainingCredits":98256037}
   * @returns {PdfResponse}
   */
  async compressPdf(fileUrl, httpUsername, httpPassword, name, expiration, password, async, profiles) {
    logger.debug(`[compressPdf] Starting PDF compressing for: ${ fileUrl }`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/optimize`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        name,
        expiration,
        password,
        async,
        profiles,
      },
      logTag: 'compressPdf',
    })
  }

  /**
   * @description Retrieves the current status and results of an asynchronous background job that was previously initiated with PDF.co API. Use this method to check if long-running operations have completed and to download the results. Essential for monitoring the progress of async PDF processing tasks.
   *
   * @route POST /getJobStatus
   * @operationName Check Background Job Status
   * @category Job Management
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The unique identifier of the background job returned when an async operation was started. This ID is used to track and retrieve the results of the processing task."}
   * @paramDef {"type":"Boolean","label":"Force Status Check","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Set to true to forcibly refresh the job status from the processing queue. Use only for very long-running operations that may appear stuck. Normal status checks are sufficient in most cases."}
   *
   * @sampleResult {"status":"success","message":"Success","url":"https://pdf-temp-files.s3.us-west-2.amazonaws.com/6YSZD3U872ZYYFEDMQCQSGEEO8YSF5WA--151-300/L8QYIZQ6KZOITCT0PXUNPM6HKYSP5OIO.json?X-Amz-Expires=3600&X-Amz-Security-Token=FwoGZXIvYXdzECcaDAbrXwAd1IYG3nZR5yKCAdcavWT%2BuwTotGsad9asqRzowPa1M4BoIWU0M9FqXNJP8xBIQX1Cn7XTq4ZfpklsxcpGE4WcapfHdooi2uR1QWw4kuUlMGGU92uy7pS0RhaGCEL00ES%2BIb%2F5039yyAFklqfAgDlHvi47I7Pp01y6Ua25RzrZGh6ACOd7le%2BXArnbQs4o4ezNqgYyKD%2FCX1I5ZOS0tu0ND0I%2FUWTHp6OR8He9a0dgVXfiMU7pNkwQqwVVFcM%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA4NRRSZPHAZTLLKK5/20231114/us-west-2/s3/aws4_request&X-Amz-Date=20231114T134932Z&X-Amz-SignedHeaders=host&X-Amz-Signature=e5553e080a23fb158c0514f99c9f70be0cb74f764933d712ba628110d4079b4c","jobId":"6YSZD3U872ZYYFEDMQCQSGEEO8YSF5WA--151-300","credits":2,"remainingCredits":1480582,"duration":33}
   * @returns {JobStatusResponse}
   */
  async getJobStatus(jobId, force) {
    logger.debug(`[getJobStatus] Checking job status for: ${ jobId }`)

    if (!jobId) {
      throw new Error('Job ID is required for status checking')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/job/check`,
      method: 'post',
      body: { jobId, force },
      logTag: 'getJobStatus',
    })
  }

  /**
   * @description Adds password and security limitations to PDF.
   *
   * @route POST /addSecurityToPdf
   * @operationName Add Security to PDF
   * @category PDF Security
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"Owner Password","name":"ownerPassword","required":true,"description":"The main owner password that is used for document encryption and for setting restrictions."}
   * @paramDef {"type":"String","label":"User Password","name":"userPassword","description":"The optional user password will be asked for viewing and printing document."}
   * @paramDef {"type":"String","label":"Encryption Algorithm","name":"encryptionAlgorithm","uiComponent":{"type":"DROPDOWN","options":{"values":["RC4_40bit","RC4_128bit","AES_128bit","AES_256bit"]}},"description":"Set an encryption algorithm. `AES_128bit` or higher is recommended."}
   * @paramDef {"type":"Boolean","label":"Allow Accessibility Support","name":"allowAccessibilitySupport","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit content extraction for accessibility needs. Note: this restriction applies when `userPassword` (if any) is entered."}
   * @paramDef {"type":"Boolean","label":"Allow Assembly Document","name":"allowAssemblyDocument","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit assembling the document. Note: this restriction applies when `userPassword` (if any) is entered."}
   * @paramDef {"type":"Boolean","label":"Allow Print Document","name":"allowPrintDocument","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit printing PDF document. Note: this restriction applies when `userPassword` (if any) is entered."}
   * @paramDef {"type":"Boolean","label":"Allow Fill Forms","name":"allowFillForms","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit the filling of interactive form fields (including signature fields) in the PDF documents."}
   * @paramDef {"type":"Boolean","label":"Allow Modify Document","name":"allowModifyDocument","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit modification of PDF document."}
   * @paramDef {"type":"Boolean","label":"Allow Content Extraction","name":"allowContentExtraction","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit copying content from PDF document."}
   * @paramDef {"type":"Boolean","label":"Allow Modify Annotations","name":"allowModifyAnnotations","uiComponent":{"type":"TOGGLE"},"description":"Allow or prohibit interacting with text annotations and forms in PDF document."}
   * @paramDef {"type":"String","label":"Print Quality","name":"printQuality","uiComponent":{"type":"DROPDOWN","options":{"values":["HighResolution","LowResolution"]}},"description":"Allowed printing quality."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"File name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.amazonaws.com/eaa441ade38548b8a3a96d8014c4f463/sample1.pdf","pageCount":1,"error":false,"status":200,"name":"sample1.pdf","remainingCredits":616208,"credits":14}
   * @returns {PdfResponse}
   */
  async addSecurityToPdf(
    fileUrl,
    ownerPassword,
    userPassword,
    encryptionAlgorithm,
    allowAccessibilitySupport,
    allowAssemblyDocument,
    allowPrintDocument,
    allowFillForms,
    allowModifyDocument,
    allowContentExtraction,
    allowModifyAnnotations,
    printQuality,
    async,
    name,
    expiration,
    profiles
  ) {
    logger.debug(`[addSecurityToPdf] Starting adding security for: ${ fileUrl }`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/security/add`,
      method: 'post',
      body: {
        url: fileUrl,
        ownerPassword,
        userPassword,
        encryptionAlgorithm,
        allowAccessibilitySupport,
        allowAssemblyDocument,
        allowPrintDocument,
        allowFillForms,
        allowModifyDocument,
        allowContentExtraction,
        allowModifyAnnotations,
        printQuality,
        async,
        name,
        expiration,
        profiles,
      },
      logTag: 'addSecurityToPdf',
    })
  }

  /**
   * @description Removes existing limits and password from existing PDF files.
   *
   * @route POST /removeSecurityFromPdf
   * @operationName Remove Security from PDF
   * @category PDF Security
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"Owner/User Password","name":"password","description":"The owner/user password to open files and remove security features."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"File name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.amazonaws.com/9f2a754f76db46ac93781b3d2c6694c3/ProtectedPDFFile.pdf","pageCount":1,"error":false,"status":200,"name":"ProtectedPDFFile.pdf","remainingCredits":616187,"credits":21}
   * @returns {PdfResponse}
   */
  async removeSecurityFromPdf(fileUrl, password, async, name, expiration, profiles) {
    logger.debug(`[removeSecurityFromPdf] Starting removing security for: ${ fileUrl }`)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/security/remove`,
      method: 'post',
      body: { url: fileUrl, password, async, name, expiration, profiles },
      logTag: 'removeSecurityFromPdf',
    })
  }

  /**
   * @description Creates high-quality barcode images in various formats including QR Code, Code 128, DataMatrix, PDF417, and many other standard barcode types. Supports custom sizing, logo embedding (for QR codes), and various output formats. Perfect for inventory management, product labeling, document tracking, and mobile applications.
   *
   * @route POST /generateBarcode
   * @operationName Generate Barcode Image
   * @category Barcode Generation
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Barcode Value","name":"value","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text or data to encode in the barcode. For QR codes, this can be URLs, contact info, or plain text. For product codes, use the appropriate format (UPC, EAN, etc.)."}
   * @paramDef {"type":"String","label":"Barcode Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["QRCode","Code128","Code39","DataMatrix","PDF417","EAN13","EAN8","UPCA","UPCE","Aztec","MaxiCode","Code93","Codabar","Interleaved2of5","ITF14","GTIN12","GTIN13","GTIN14","GTIN8","Code16K","Code39Extended","Code39Mod43","Code39Mod43Extended","CodablockF","DPMDataMatrix","EAN2","EAN5","GS1 - 128","GS1DataBarExpanded","GS1DataBarExpandedStacked","GS1DataBarLimited","GS1DataBarOmnidirectional","GS1DataBarStacked","IntelligentMail","MICR","MicroPDF","MSI","PatchCode","Pharmacode","PostNet","PZN","RoyalMail","RoyalMailKIX","Trioptic","UPU","AustralianPostCode"]}},"description":"The type of barcode to generate. QRCode is recommended for general use, Code128 for alphanumeric data, DataMatrix for small spaces, PDF417 for large amounts of data."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Custom name for the generated barcode image file (e.g., 'product-barcode.png'). If not specified, a default name will be generated."}
   * @paramDef {"type":"Number","label":"Link Expiration (Minutes)","name":"expiration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Expiration time for the output image link in minutes (default: 60). After this time, the barcode image will be automatically deleted from temporary storage."}
   * @paramDef {"type":"Boolean","label":"Return Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to true to return the barcode image data directly in the response (base64 encoded). If false, returns a URL to download the image file."}
   * @paramDef {"type":"String","label":"Logo/Decoration Image URL","name":"decorationImage","description":"URL of a logo image to embed inside QR codes (QR codes only). The image should be square and will be placed in the center of the QR code. Recommended size: 64x64 pixels or smaller."}
   * @paramDef {"type":"Boolean","label":"Async Processing","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to true to process the request asynchronously. The API will return a jobId that can be used to check the processing status and retrieve the barcode image later."}
   * @paramDef {"type":"String","label":"Barcode Profiles (JSON)","name":"profiles","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object with advanced barcode generation settings like size, resolution, colors, etc. Example: '{\"Width\":200,\"Height\":200,\"Resolution\":300}'. See PDF.co Profiles documentation for all available options."}
   *
   * @sampleResult {"url":"https://pdf-temp-files.s3.amazonaws.com/72bc579b37844d9f9e63ce06de5196d8/barcode.png","error":false,"status":200,"name":"barcode.png","duration":380,"remainingCredits":98725598,"credits":7}
   * @returns {PdfResponse}
   */
  async generateBarcode(value, type, name, expiration, inline, decorationImage, async, profiles) {
    logger.debug(
      `[generateBarcode] Starting barcode generation for value: ${
        value ? value.substring(0, 50) + '...' : 'empty'
      } type: ${ type }`
    )

    if (!value || !type) {
      throw new Error('Both barcode value and type are required for barcode generation')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/barcode/generate`,
      method: 'post',
      body: { value, type, name, expiration, inline, decorationImage, async, profiles },
      logTag: 'generateBarcode',
    })
  }

  /**
   * @description Reads barcodes from images and PDF. Can read all popular barcode types from QR Code and Code 128, EAN to Datamatrix, PDF417, GS1 and many other barcodes.
   *
   * @route POST /readBarcodes
   * @operationName Read Barcodes
   * @category Barcode Recognition
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL to the source file."}
   * @paramDef {"type":"String","label":"Barcode Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["AustralianPostCode","Aztec","Codabar","CodablockF","Code128","Code16K","Code39","Code39Extended","Code39Mod43","Code39Mod43Extended","Code93","DataMatrix","DPMDataMatrix","EAN13","EAN2","EAN5","EAN8","GS1 - 128","GS1DataBarExpanded","GS1DataBarExpandedStacked","GS1DataBarLimited","GS1DataBarOmnidirectional","GS1DataBarStacked","GTIN12","GTIN13","GTIN14","GTIN8","IntelligentMail","Interleaved2of5","ITF14","MaxiCode","MICR","MicroPDF","MSI","PatchCode","PDF417","Pharmacode","PostNet","PZN","QRCode","RoyalMail","RoyalMailKIX","Trioptic","UPCA","UPCE","UPU"]}},"description":"Set the barcode type."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Comma-separated list of page indices or ranges to process (e.g., `0,1,2-`). The first page index is `0`."}
   * @paramDef {"type":"String","label":"Object Types","name":"types","description":"Comma-separated list of object types to decode. Object types supported: `Checkbox`, `Radiobox`, `Segment`, `UnderlinedField`, `Rectangle`, `Oval`, `HorizontalLine`, `VerticalLine`."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` for long processes to run in the background, API will then return a `jobId` which you can use with the [Background Job Check](https://developer.pdf.co/api/background-job-check/index.html#job-check) endpoint to check the status of the process and retrieve the output while you can proceed with other tasks."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"barcodes":[{"Value":"abcdef123456","RawData":"","Type":14,"Rect":"{X=448,Y=23,Width=106,Height=112}","Page":0,"File":"https://pdfco-test-files.s3.us-west-2.amazonaws.com/barcode-reader/sample.pdf","Confidence":1,"Metadata":"","TypeName":"QRCode"}],"pageCount":1,"error":false,"status":200,"remainingCredits":99826192,"credits":35}
   * @returns {Barcodes}
   */
  async readBarcodes(fileUrl, type, httpUsername, httpPassword, pages, types, async, profiles) {
    logger.debug(`[readBarcodes] Starting barcode reading for file: ${ fileUrl } type: ${ type }`)

    if (!fileUrl || !type) {
      throw new Error('Both file URL and barcode type are required for barcode reading')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/barcode/read/from/url`,
      method: 'post',
      body: {
        url: fileUrl,
        type,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        types,
        async,
        profiles,
      },
      logTag: 'readBarcodes',
    })
  }

  /**
   * @description Converts PDF documents to various output formats including structured data (CSV, JSON, Excel), web formats (HTML, XML), plain text, and images. This universal conversion method handles format detection and optimal conversion settings automatically. Perfect for data extraction, content migration, and format standardization workflows.
   *
   * @route POST /convertPdfTo
   * @operationName Convert PDF to Multiple Formats
   * @category Document Conversion
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"PDF URL","name":"fileUrl","required":true,"description":"The publicly accessible URL of the PDF document to be converted to the specified format."}
   * @paramDef {"type":"String","label":"Target Format","name":"convertTo","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["CSV","JSON","JSON_Meta","Text","Text_Simple","Excel","ExcelX","XML","HTML","Image_JPG","Image_PNG","Image_WEBP","Image_TIFF"]}},"description":"The target output format. CSV for tabular data, JSON for structured data, Excel for spreadsheets, HTML/XML for web content, Text for plain text, Images for visual conversion."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Comma-separated list of page indices or ranges to process (e.g., `0,1,2-`). The first page index is `0`."}
   * @paramDef {"type":"Boolean","label":"Unwrap Lines","name":"unwrap","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` to unwrap lines into a single line within table cells when `lineGrouping` is enabled."}
   * @paramDef {"type":"String","label":"Region Coordinates","name":"rect","description":"Defines coordinates for extraction in the format `x1,y1,x2,y2`."}
   * @paramDef {"type":"String","label":"OCR Language","name":"lang","uiComponent":{"type":"DROPDOWN","options":{"values":["afr","amh","ara","asm","aze","aze_cyrl","bel","ben","bod","bos","bul","cat","ceb","ces","chi_sim","chi_tra","chr","cym","dan","deu","dzo","ell","eng","enm","epo","est","eus","fas","fin","fra","frk","frm","gle","glg","grc","guj","hat","heb","hin","hrv","hun","iku","ind","isl","ita","ita_old","jav","jpn","kan","kat","kat_old","kaz","khm","kir","kor","kur","lao","lat","lav","lit","mal","mar","mkd","mlt","msa","mya","nep","nld","nor","ori","pan","pol","por","pus","ron","rus","san","sin","slk","slv","spa","spa_old","sqi","srp","srp_latn","swa","swe","syr","tam","tel","tgk","tgl","tha","tir","tur","uig","ukr","urd","uzb","uzb_cyrl","vie","yid"]}},"description":"Language for OCR when processing scanned PDFs. Default is `eng`. You may specify multiple languages like `eng+deu` (see [Language Support](https://developer.pdf.co/api/pdf-make-text-searchable-or-unsearchable/index.html#language-support))."}
   * @paramDef {"type":"Boolean","label":"Inline","name":"inline","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` to return results directly in the response. If `false`, returns a link to the output file."}
   * @paramDef {"type":"String","label":"Line Grouping","name":"lineGrouping","description":"Line grouping within table cells. Set to `1` to enable grouping."}
   * @paramDef {"type":"String","label":"PDF Password","name":"password","description":"Password for the PDF file, if it's protected."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` to process the request asynchronously. The API will return a `jobId` for status checks."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Desired name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"body":"PDF body","pageCount":2,"error":false,"status":200,"name":"result.csv","remainingCredits":616411,"credits":56}
   * @returns {PdfResponse}
   */
  async convertPdfTo(
    fileUrl,
    convertTo,
    httpUsername,
    httpPassword,
    pages,
    unwrap,
    rect,
    lang,
    inline,
    lineGrouping,
    password,
    async,
    name,
    expiration,
    profiles
  ) {
    logger.debug(`[convertPdfTo] Starting PDF conversion to: ${ convertTo }`)

    const format = ConvertToMap[convertTo]

    if (!format) {
      throw new Error(`[convertPdfTo] Unsupported conversion format: ${ convertTo }`)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/convert/to/${ format }`,
      method: 'post',
      body: {
        url: fileUrl,
        httpusername: httpUsername,
        httppassword: httpPassword,
        pages,
        unwrap,
        rect,
        lang,
        inline,
        lineGrouping,
        password,
        async,
        name,
        expiration,
        profiles,
      },
      logTag: 'convertPdfTo',
    })
  }

  /**
   * @description Converts various document formats (Word, Excel, HTML, images, emails, URLs) into high-quality PDF documents. Supports both file URLs and raw HTML content, with optional HTML template integration for consistent branding and formatting. Ideal for document standardization, report generation, and archival purposes.
   *
   * @route POST /convertToPdfFrom
   * @operationName Convert Multiple Formats to PDF
   * @category Document Conversion
   *
   * @appearanceColor #F15A24 #F7941D
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Source File URL","name":"fileUrl","description":"The publicly accessible URL of the source document to be converted to PDF. Required when converting from document files, images, or web pages. Not needed when using raw HTML or templates."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Raw HTML code to be converted to PDF. Use this when you have HTML content directly rather than a file URL. Cannot be used together with templateId."}
   * @paramDef {"type":"String","label":"HTML Template","name":"templateId","dictionary":"getHtmlTemplatesDictionary","description":"Select a pre-configured HTML template from your PDF.co account for consistent PDF generation. Use instead of raw HTML when you have reusable templates."}
   * @paramDef {"type":"String","label":"Source Format","name":"convertFrom","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Document","CSV","Image","URL","HTML","Email"]}},"description":"The format of the source content. Document for Word/Excel files, HTML for web content, Image for pictures, URL for web pages, Email for email messages, CSV for data tables."}
   * @paramDef {"type":"String","label":"HTTP Username","name":"httpUsername","description":"HTTP authentication username for accessing the source URL, if required."}
   * @paramDef {"type":"String","label":"HTTP Password","name":"httpPassword","description":"HTTP authentication password for accessing the source URL, if required."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Set to `true` to process the request asynchronously. The API will return a `jobId` for status checks."}
   * @paramDef {"type":"String","label":"Output File Name","name":"name","description":"Desired name for the generated output file."}
   * @paramDef {"type":"Number","label":"Expiration","name":"expiration","description":"Set the expiration time for the output link in minutes (default is `60`, i.e., 60 minutes or 1 hour). After this duration, any generated output file(s) will be automatically deleted from [PDF.co Temporary Files Storage](https://developer.pdf.co/api#temporary-files-storage). The maximum duration for link expiration varies based on your current subscription plan. To store permanent input files (e.g., reusable images, PDF templates, documents), consider using [PDF.co Built-In Files Storage](https://app.pdf.co/files)."}
   * @paramDef {"type":"String","label":"Profiles Object","name":"profiles","description":"Use this parameter to set additional configurations for fine-tuning and extra options. Explore the [Profiles section](https://developer.pdf.co/api/profiles/index.html#api-profiles) for more. Example: `{\"ImageOptimizationFormat\":\"JPEG\",\"JPEGQuality\":25,\"ResampleImages\":true,\"ResamplingResolution\":120,\"GrayscaleImages\":false}`."}
   *
   * @sampleResult {"body":"PDF body","pageCount":2,"error":false,"status":200,"name":"result.csv","remainingCredits":616411,"credits":56}
   * @returns {PdfResponse}
   */
  async convertToPdfFrom(
    fileUrl,
    html,
    templateId,
    convertFrom,
    httpUsername,
    httpPassword,
    async,
    name,
    expiration,
    profiles
  ) {
    logger.debug(`[convertToPdfFrom] Starting conversion to PDF from: ${ convertFrom }`)

    const format = ConvertFromMap[convertFrom]

    if (!format) {
      throw new Error(`[convertToPdfFrom] Unsupported conversion format: ${ convertFrom }`)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/pdf/convert/from/${ format }`,
      method: 'post',
      body: {
        url: fileUrl,
        html,
        templateId,
        httpusername: httpUsername,
        httppassword: httpPassword,
        async,
        name,
        expiration,
        profiles,
      },
      logTag: 'convertToPdfFrom',
    })
  }
}

Flowrunner.ServerCode.addService(PdfcoService, [
  {
    order: 0,
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    name: 'apiKey',
    hint: 'Get your API key from https://app.pdf.co/account. Required for all PDF operations. Determines usage limits, features, and credit consumption.',
  },
])

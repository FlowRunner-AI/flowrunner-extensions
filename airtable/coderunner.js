const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Airtable',
  },

  app: {
    model: 'Airtable Service',
    exclude: [],
  },
})

const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Brevo',
  },

  app: {
    model: 'Brevo Service',
    exclude: [],
  },
})

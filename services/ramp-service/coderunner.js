const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Ramp',
  },

  app: {
    model: 'Ramp Service',
    exclude: [],
  },
})

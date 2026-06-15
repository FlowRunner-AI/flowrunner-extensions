const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Front',
  },

  app: {
    model: 'Front Service',
    exclude: [],
  },
})

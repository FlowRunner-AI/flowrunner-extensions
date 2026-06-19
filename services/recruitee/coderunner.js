const { prepareCoderunnerConfig } = require('../../coderunner')

module.exports = prepareCoderunnerConfig({
  marketplaceProduct: {
    name: 'Recruitee',
  },
  app: {
    model: 'RecruiteeService',
    exclude: [],
  },
})

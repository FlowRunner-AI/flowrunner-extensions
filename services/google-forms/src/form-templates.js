const ORDER_REQUEST = [
  {
    createItem: {
      location: { index: 0 },
      item: {
        title: 'Are you a new or existing customer?',
        questionItem: {
          question: {
            choiceQuestion: {
              options: [{ value: 'I am a new customer' }, { value: 'I am an existing customer' }],
              type: 'RADIO',
            },
            questionId: '000f4279',
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 1 },
      item: {
        title: 'What is the item you would like to order?',
        description: 'Please enter the product number',
        questionItem: {
          question: {
            textQuestion: {},
            questionId: '000f425b',
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 2 },
      item: {
        title: 'What color(s) would you like to order?',
        questionItem: {
          question: {
            choiceQuestion: {
              options: [{ value: 'color 1' }, { value: 'color 2' }, { value: 'color 3' }, { value: 'color 4' }],
              type: 'CHECKBOX',
            },
            questionId: '39a4f614',
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 3 },
      item: {
        title: 'Product options',
        description: 'Choose size and number per color',
        questionItem: {
          question: {
            textQuestion: {
              paragraph: true,
            },
            questionId: '7a805a0c',
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 4 },
      item: {
        title: 'Contact info',
        textItem: {},
      },
    },
  },
  {
    createItem: {
      location: { index: 5 },
      item: {
        title: 'Your name',
        questionItem: {
          question: {
            textQuestion: {},
            questionId: '000f4254',
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 6 },
      item: {
        title: 'Phone number',
        questionItem: {
          question: {
            textQuestion: {},
            questionId: '000f4256',
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 7 },
      item: {
        title: 'E-mail',
        questionItem: {
          question: {
            textQuestion: {},
            questionId: '000f4259',
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 8 },
      item: {
        title: 'Preferred contact method',
        questionItem: {
          question: {
            choiceQuestion: {
              options: [{ value: 'Phone' }, { value: 'Email' }],
              type: 'CHECKBOX',
            },
            questionId: '000f425a',
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 9 },
      item: {
        title: 'Questions and comments',
        questionItem: {
          question: {
            textQuestion: {
              paragraph: true,
            },
            questionId: '000f4257',
          },
        },
      },
    },
  },
]

const CONTACT_INFORMATION = [
  {
    createItem: {
      location: { index: 0 },
      item: { title: 'Name', questionItem: { question: { questionId: '778b574a', textQuestion: {}, required: true } } },
    },
  },
  {
    createItem: {
      location: { index: 1 },
      item: {
        title: 'Email',
        questionItem: { question: { questionId: '3e555b2b', textQuestion: {}, required: true } },
      },
    },
  },
  {
    createItem: {
      location: { index: 2 },
      item: {
        title: 'Address',
        questionItem: { question: { questionId: '3f7b522a', textQuestion: { paragraph: true }, required: true } },
      },
    },
  },
  {
    createItem: {
      location: { index: 3 },
      item: { title: 'Phone number', questionItem: { question: { questionId: '458e9ec2', textQuestion: {} } } },
    },
  },
  {
    createItem: {
      location: { index: 4 },
      item: {
        title: 'Comments',
        questionItem: { question: { questionId: '320744c8', textQuestion: { paragraph: true } } },
      },
    },
  },
]

const JOB_APPLICATION = [
  {
    createItem: {
      location: { index: 0 },
      item: {
        itemId: '133ed267',
        title: 'Name',
        description: 'First and last name',
        questionItem: {
          question: {
            questionId: '6a2f8ab5',
            textQuestion: {},
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 1 },
      item: {
        itemId: '3e8edefc',
        title: 'Email',
        questionItem: {
          question: {
            questionId: '61c73e81',
            textQuestion: {},
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 2 },
      item: {
        itemId: '07179af1',
        title: 'Phone number',
        questionItem: {
          question: {
            questionId: '11c2cd54',
            textQuestion: {},
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 3 },
      item: {
        itemId: '41adfba5',
        title: 'Which position(s) are you interested in?',
        questionItem: {
          question: {
            choiceQuestion: {
              options: [{ value: 'Position 1' }, { value: 'Position 2' }, { value: 'Position 3' }],
              type: 'CHECKBOX',
            },
            questionId: '40410bc5',
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 4 },
      item: {
        itemId: '0f9e2d47',
        title: 'Submit your cover letter or resume',
        questionItem: {
          question: {
            questionId: '79a53575',
            textQuestion: {
              paragraph: true,
            },
          },
        },
      },
    },
  },
]

const CUSTOMER_FEEDBACK = [
  {
    createItem: {
      location: { index: 0 },
      item: {
        itemId: '732fcb96',
        title: 'Feedback Type',
        questionItem: {
          question: {
            choiceQuestion: {
              options: [
                { value: 'Comments' },
                { value: 'Questions' },
                { value: 'Bug Reports' },
                { value: 'Feature Request' },
              ],
              type: 'RADIO',
            },
            questionId: '5ede6594',
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 1 },
      item: {
        itemId: '45d2b450',
        title: 'Feedback',
        questionItem: {
          question: {
            questionId: '137cf025',
            textQuestion: {
              paragraph: true,
            },
            required: true,
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 2 },
      item: {
        itemId: '795e12a1',
        title: 'Suggestions for improvement',
        questionItem: {
          question: {
            questionId: '651957f9',
            textQuestion: {
              paragraph: true,
            },
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 3 },
      item: {
        itemId: '538f0ab4',
        title: 'Name',
        questionItem: {
          question: {
            questionId: '1cef0da8',
            textQuestion: {},
          },
        },
      },
    },
  },
  {
    createItem: {
      location: { index: 4 },
      item: {
        itemId: '0a4bfb2b',
        title: 'Email',
        questionItem: {
          question: {
            questionId: '346c97bf',
            textQuestion: {},
          },
        },
      },
    },
  },
]

const JSON_Templates = {
  'Contact Information': CONTACT_INFORMATION,
  'Order Request': ORDER_REQUEST,
  'Job Application': JOB_APPLICATION,
  'Customer Feedback': CUSTOMER_FEEDBACK,
}

module.exports = {
  JSON_Templates,
}

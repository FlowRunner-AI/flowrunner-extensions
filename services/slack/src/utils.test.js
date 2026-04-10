// Run with: node ./tests.js --test

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { chunkMarkdown } = require('./utils')

// Helper to validate balanced markdown constructs in a chunk
function isBalanced(chunk, regex) {
  const matches = chunk.match(regex) || []

  return matches.length % 2 === 0
}

describe('Slack chunkMarkdown util function', () => {
  describe('basic cases', () => {
    it('should keep bold block', () => {
      const sourceText = 'foo **bold** bar'
      const parts = chunkMarkdown(sourceText, 5)
      const targetText = parts.join('')

      assert.strictEqual(parts.length, 3, 'Expected exactly one chunk')
      assert.strictEqual(targetText, sourceText, 'Chunk content must match original')

      assert.deepStrictEqual(
        parts,
        ['foo ', '**bold**', ' bar'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('should keep bold italic', () => {
      const sourceText = 'foo _bold text_ bar'
      const parts = chunkMarkdown(sourceText, 5)
      const targetText = parts.join('')

      assert.strictEqual(parts.length, 3, 'Expected exactly one chunk')
      assert.strictEqual(targetText, sourceText, 'Chunk content must match original')

      assert.deepStrictEqual(
        parts,
        ['foo ', '_bold text_', ' bar'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('short text produces 3 chunks', () => {
      const sourceText = 'Short **bold** and'
      const parts = chunkMarkdown(sourceText, 10)
      const targetText = parts.reduce((s, part) => s + part, '')

      assert.strictEqual(parts.length, 3, 'Expected exactly one chunk')
      assert.strictEqual(targetText, sourceText, 'Chunk content must match original')

      assert.deepStrictEqual(
        parts,
        ['Short ', '**bold** ', 'and'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('short text produces single chunk', () => {
      const txt = 'Short **bold** and [link](url)'
      const parts = chunkMarkdown(txt, 3000)
      assert.strictEqual(parts.length, 1, 'Expected exactly one chunk')
      assert.strictEqual(parts[0], txt, 'Chunk content must match original')

      assert.deepStrictEqual(
        parts,
        ['Short **bold** and [link](url)'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('all chunks reassemble to original text', () => {
      const txt = 'a '.repeat(10).trim()
      const max = 5
      const parts = chunkMarkdown(txt, max)
      assert.strictEqual(parts.join(''), txt, 'Chunks must join back to original')

      assert.deepStrictEqual(
        parts,
        ['a a a', ' a a ', 'a a a', ' a a'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('no chunk exceeds maximum length', () => {
      const txt = 'a '.repeat(10).trim()
      const max = 5
      const parts = chunkMarkdown(txt, max)

      for (const p of parts) {
        assert.ok(p.length <= max, `Chunk "${ p }" length ${ p.length } > ${ max }`)
      }

      assert.deepStrictEqual(
        parts,
        ['a a a', ' a a ', 'a a a', ' a a'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('markdown delimiters are never broken across chunks', () => {
      const txt = '12345 **hello** *world* 67890'
      const max = 10
      const parts = chunkMarkdown(txt, max)

      for (const p of parts) {
        // Check bold
        assert.ok(isBalanced(p, /\*\*/g), 'Bold delimiters ** must be balanced in each chunk')
        // Check italic
        assert.ok(isBalanced(p, /\*/g), 'Italic delimiters * must be balanced in each chunk')
      }

      assert.strictEqual(parts.join(''), txt, 'Rejoined text must match')

      assert.deepStrictEqual(
        parts,
        ['12345 ', '**hello** ', '*world* ', '67890'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })

    it('links and parentheses are never broken across chunks', () => {
      const link = '[click me](http://example.com/path)'
      const txt = '1234 ' + link + ' 5678'
      const max = 12
      const parts = chunkMarkdown(txt, max)

      for (const p of parts) {
        // Balanced brackets
        const openB = (p.match(/\[/g) || []).length
        const closeB = (p.match(/\]/g) || []).length
        assert.strictEqual(openB, closeB, 'Brackets [ ] must be balanced')
        // Balanced parentheses
        const openP = (p.match(/\(/g) || []).length
        const closeP = (p.match(/\)/g) || []).length
        assert.strictEqual(openP, closeP, 'Parens ( ) must be balanced')
      }

      assert.strictEqual(parts.join(''), txt, 'Rejoined text must match')

      assert.deepStrictEqual(
        parts,
        ['1234 [click me](http://example.com/path)', ' 5678'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })
  })

  describe('slack markdown syntax', () => {
    // test/markdown-chunk.test.js
    // Run with: node --test

    // 1) Bold
    it('bold markup intact', () => {
      const txt = '*bold text*'
      const parts = chunkMarkdown(txt, 12)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 2) Italic
    it('italic markup intact', () => {
      const txt = '_italic text_'
      const parts = chunkMarkdown(txt, 13)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 3) Strikethrough
    it('strikethrough markup intact', () => {
      const txt = '~strikethrough~'
      const parts = chunkMarkdown(txt, 20)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 4) Inline code
    it('inline code intact', () => {
      const txt = '`inline code`'
      const parts = chunkMarkdown(txt, 12)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 5) Fenced code block
    it('fenced code block intact', () => {
      const txt = '```js\nconsole.log(1);\n```'
      const parts = chunkMarkdown(txt, 50)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 6) Markdown link ([text](url))
    it('markdown link intact', () => {
      const txt = '[click here](https://example.com)'
      const parts = chunkMarkdown(txt, 30)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 7) Slack user mention (<@U123456>)
    it('user mention intact', () => {
      const txt = '<@U123456>'
      const parts = chunkMarkdown(txt, 5)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 8) Bullet list
    it('bullet list intact', () => {
      const txt = '- item one\n- item two'
      const parts = chunkMarkdown(txt, 30)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 9) Blockquote
    it('blockquote intact', () => {
      const txt = '> quoted line'
      const parts = chunkMarkdown(txt, 15)
      assert.strictEqual(parts.length, 1)
      assert.strictEqual(parts[0], txt)
    })

    // 10) Long fenced code block splits by lines
    it('long fenced code splits by line boundaries', () => {
      const txt = 'foo ```my code``` bar'
      const max = 10
      const parts = chunkMarkdown(txt, max)
      // Each part ≤ max
      assert.strictEqual(parts.length, 3)

      assert.deepStrictEqual(
        parts,
        ['foo ', '```my code```', ' bar'],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )

      assert.strictEqual(parts.join(''), txt)
    })
  })

  describe('real message', () => {
    it('#1', () => {
      const sourceText = 'Hi! Great question—what you\'re trying to achieve is a common scenario and can be accomplished efficiently with Flowrunner. Below I\'ll walk you through the general logic and provide details on how to collect and process the values, then update both users accordingly. ### Overview You have: - A user table with a numeric field: `money` - An input value from a user form - Two calculated fields: `money - input` and `money + input` (for sender and receiver, respectively) - The requirement to select a recipient, send a value, subtract from sender, and add to recipient --- ### Step-by-step Solution #### 1. **Collect Values** - When the sender ("adam") selects the recipient ("bob") and enters the amount to send, you\'ll have: - Sender\'s objectId (e.g., from the logged-in user) - Recipient\'s objectId (e.g., chosen from a user list) - Transfer amount (from the input) #### 2. **Fetch Current User Balances** Use [Data Service API](https://fr-demo.com/docs/rest/data_basic_find.html) or the appropriate SDK to fetch both user objects by their `objectId`: ```javascript // Example using JS SDK const sender = await FR.Data.of(\'Users\').findById(senderObjectId); const recipient = await FR.Data.of(\'Users\').findById(recipientObjectId); ``` #### 3. **Calculate New Values** ```javascript const amount = Number(inputAmount); const newSenderMoney = sender.money - amount; const newRecipientMoney = recipient.money + amount; ``` *You can save these as the calculated/generated fields if needed.* #### 4. **Update Both Users** ```javascript sender.money = newSenderMoney; recipient.money = newRecipientMoney; // Option 1: Update sequentially await FR.Data.of(\'Users\').save(sender); await FR.Data.of(\'Users\').save(recipient); // Option 2: Update in parallel await Promise.all([ FR.Data.of(\'Users\').save(sender), FR.Data.of(\'Users\').save(recipient) ]); ``` > **Tip:** If you add additional fields for the calculations (`X` and `Y`), update those along with the `money` field. #### 5. **Considerations** - You might want to add business logic to ensure `sender.money >= amount`. - For better data integrity (e.g., to avoid race conditions), consider using a [Cloud Code (Codeless or JS) custom API service](https://fr-demo.com/docs/js/cloud_code_custom_services.html). --- ### Documentation & Examples - [User Table Data Manipulation (Docs)](https://fr-demo.com/docs/js/users_update.html) - [Forum thread: Transfer money between users](https://support.fr-demo.com/t/best-way-to-transfer-value-from-one-user-to-another/16136) – Similar to your scenario. --- ### Sample Codeless Workflow If you want a no-code (Codeless) approach: 1. Add a [Custom Codeless API Service](https://fr-demo.com/docs/bl-uisdk/custom_services.html). 2. Create a method that: - Gets both users, - Calculates new balances, - Updates both records, - Returns updated balances to your frontend. --- Let me know if you\'d like an example in a specific SDK or a Codeless workflow! This logic is flexible and can be implemented in various ways depending on your stack (JS, Flutter, REST, etc.). **Happy coding!** If you run into issues or want to discuss best practices (such as transaction safety), feel free to reply or check [this similar thread](https://support.fr-demo.com/t/best-way-to-transfer-value-from-one-user-to-another/16136). Best, Flowrunner Team'
      const parts = chunkMarkdown(sourceText, 3000)
      const targetText = parts.reduce((s, part) => s + part, '')

      assert.strictEqual(parts.length, 2, 'Expected 7 chunks for the real message')

      // And no chunk should exceed the max length
      for (const p of parts) {
        assert.ok(p.length <= 3000, `Chunk length ${ p.length } exceeds limit`)
      }

      assert.strictEqual(parts[0].length, 1845, 'A chank contains specific number of characters')
      assert.strictEqual(parts[1].length, 1470, 'A chank contains specific number of characters')

      assert.strictEqual(targetText.length, sourceText.length, 'sum')

      assert.deepStrictEqual(
        parts,
        [
          "Hi! Great question—what you're trying to achieve is a common scenario and can be accomplished efficiently with Flowrunner. Below I'll walk you through the general logic and provide details on how to collect and process the values, then update both users accordingly. ### Overview You have: - A user table with a numeric field: `money` - An input value from a user form - Two calculated fields: `money - input` and `money + input` (for sender and receiver, respectively) - The requirement to select a recipient, send a value, subtract from sender, and add to recipient --- ### Step-by-step Solution #### 1. **Collect Values** - When the sender (\"adam\") selects the recipient (\"bob\") and enters the amount to send, you'll have: - Sender's objectId (e.g., from the logged-in user) - Recipient's objectId (e.g., chosen from a user list) - Transfer amount (from the input) #### 2. **Fetch Current User Balances** Use [Data Service API](https://fr-demo.com/docs/rest/data_basic_find.html) or the appropriate SDK to fetch both user objects by their `objectId`: ```javascript // Example using JS SDK const sender = await FR.Data.of('Users').findById(senderObjectId); const recipient = await FR.Data.of('Users').findById(recipientObjectId); ``` #### 3. **Calculate New Values** ```javascript const amount = Number(inputAmount); const newSenderMoney = sender.money - amount; const newRecipientMoney = recipient.money + amount; ``` *You can save these as the calculated/generated fields if needed.* #### 4. **Update Both Users** ```javascript sender.money = newSenderMoney; recipient.money = newRecipientMoney; // Option 1: Update sequentially await FR.Data.of('Users').save(sender); await FR.Data.of('Users').save(recipient); // Option 2: Update in parallel await Promise.all([ FR.Data.of('Users').save(sender), FR.Data.of('Users').save(recipient) ]); ```",
          " > **Tip:** If you add additional fields for the calculations (`X` and `Y`), update those along with the `money` field. #### 5. **Considerations** - You might want to add business logic to ensure `sender.money >= amount`. - For better data integrity (e.g., to avoid race conditions), consider using a [Cloud Code (Codeless or JS) custom API service](https://fr-demo.com/docs/js/cloud_code_custom_services.html). --- ### Documentation & Examples - [User Table Data Manipulation (Docs)](https://fr-demo.com/docs/js/users_update.html) - [Forum thread: Transfer money between users](https://support.fr-demo.com/t/best-way-to-transfer-value-from-one-user-to-another/16136) – Similar to your scenario. --- ### Sample Codeless Workflow If you want a no-code (Codeless) approach: 1. Add a [Custom Codeless API Service](https://fr-demo.com/docs/bl-uisdk/custom_services.html). 2. Create a method that: - Gets both users, - Calculates new balances, - Updates both records, - Returns updated balances to your frontend. --- Let me know if you'd like an example in a specific SDK or a Codeless workflow! This logic is flexible and can be implemented in various ways depending on your stack (JS, Flutter, REST, etc.). **Happy coding!** If you run into issues or want to discuss best practices (such as transaction safety), feel free to reply or check [this similar thread](https://support.fr-demo.com/t/best-way-to-transfer-value-from-one-user-to-another/16136). Best, Flowrunner Team",
        ],
        `parts are not expected, actual:${ JSON.stringify(parts) }`
      )
    })
  })
})

# FlowRunner Service README Generation Rules

## Overview
These rules define the standard process for creating and maintaining README.md files for FlowRunner services based on their JSDoc documentation.

## Process Steps

### 1. Source Documentation
- Use the service's `src/index.js` JSDoc annotations as the source of truth
- If a `GENERATED_README.md` file is present in the service directory, it may be used as a documentation source
- This source contains the complete JSDoc-generated documentation

### 2. README Structure Requirements
Create/update the service `/README.md` file with these exact sections:

#### Required Sections (in order):
1. **Title**: `{Service Name} FlowRunner Extension`
2. **Description**: Brief overview of service purpose and functionality
   - Do NOT use the phrase "Service Description"
   - Focus on what the service does and its main capabilities
3. **Ideal Use Cases**: List of scenarios where this service is helpful
   - Use this exact heading instead of "When It Can Be Helpful in Automation"
   - Present as bullet points
4. **List of Actions**: Logically sorted list of service actions
   - No detailed descriptions - action names only
   - Sort alphabetically or by logical grouping
5. **List of Triggers**: Logically sorted list of service triggers
   - No detailed descriptions - trigger names only
   - Sort alphabetically or by logical grouping

### 3. Content Guidelines
- **Character Limit**: Maximum 2000 characters total
- **Brevity**: Remove action/trigger descriptions to save space
- **Clarity**: Use clear, concise language
- **Consistency**: Follow the exact structure for all services

### 4. Content Extraction
- Extract content from the service's `src/index.js` JSDoc (or `GENERATED_README.md` if present)
- Extract service name from integration annotations
- Identify main functionality from method descriptions
- List actions (methods with @operationName)
- List triggers (methods with @registerAs POLLING_TRIGGER or REALTIME_TRIGGER)
- Exclude system methods (@registerAs SYSTEM)
- Exclude dictionary methods (@registerAs DICTIONARY)

### 5. Formatting Standards
- Use standard Markdown formatting
- Use bullet points for lists
- Keep action/trigger names concise
- Maintain logical sorting within sections

## Application Rules
1. Process one service at a time
2. Use the service's `src/index.js` JSDoc (or `GENERATED_README.md` if present) as the source
3. Extract relevant information systematically
4. Apply character limit strictly
5. Maintain consistent structure across all services
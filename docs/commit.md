First, run these commands in order:
1. git add .
2. git --no-pager diff --staged

Then, git commit the staged changes. For the commit:

Create the message content following these rules:
- Use present tense for the subject line.
- Start the subject line with a capital letter.
- Use no prefixes in the subject.
- Be descriptive but concise.
- Use dashes for bullet points in the body.
- Avoid using backticks () within the message text itself, as they can interfere with the command.
- When constructing the git commit command, use separate -m flags for the subject line and each line of the body to ensure the multi-line message is processed correctly by the terminal.
- Do not add | cat to end of diff

Finally, call git push
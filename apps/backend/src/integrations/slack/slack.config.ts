import { SLACK_BOT_SCOPES } from '@launchstack/api-interfaces';

/**
 * The OAuth install flow is gone (no public callback URL on a desktop app), so
 * `clientId`/`clientSecret`/`redirectUri` went with it. What is left is the
 * scope list the user must grant their own Slack app before pasting its
 * `xoxb-…` token — displayed by the settings screen, which reads the same
 * constant out of `@launchstack/api-interfaces`.
 *
 * `channels:join` is not in the list: `conversations.join` is a convenience for
 * public channels only, and the bot has to be `/invite`d to a private one
 * regardless.
 */
export { SLACK_BOT_SCOPES };

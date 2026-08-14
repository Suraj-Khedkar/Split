/**
 * Build an Apple Shortcuts file.
 *
 * A `.shortcut` is a property list describing a list of actions. Apple does not
 * publish the schema, but it is stable and well documented by reverse
 * engineering, and a plain XML plist is accepted where a binary one is.
 *
 * The fiddly part, and the whole reason for generating this rather than writing
 * instructions, is how one action refers to another's output. A variable is a
 * U+FFFC placeholder inside a string plus an `attachmentsByRange` entry keyed
 * by that placeholder's character offset, pointing at the producing action's
 * UUID. Getting an offset wrong produces a shortcut that imports cleanly and
 * then sends the literal text "￼" to the server.
 *
 * Referring to outputs by UUID is also why the generated shortcut is shorter
 * than the hand-built recipe: a person needs `Set Variable` to tell three
 * identically-named "Provided Input" variables apart, and a UUID reference has
 * no such ambiguity.
 *
 * Caveat worth knowing: since iOS 15 Apple signs shared shortcuts, and signing
 * needs Apple's own tooling. An unsigned file like this one imports only if
 * "Allow Untrusted Shortcuts" is enabled under Settings → Shortcuts.
 */

/** The object replacement character iOS uses to mark a variable's position. */
const PLACEHOLDER = '￼';

/* ----------------------------- plist writing ----------------------------- */

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Marks a JS number that must serialise as <integer> rather than <real>. */
class PlistInt {
  constructor(value) {
    this.value = value;
  }
}
const int = (value) => new PlistInt(value);

/**
 * Serialise a JS value as a plist fragment.
 *
 * Written as a tree walk rather than string concatenation at the call sites:
 * the action definitions below are then plain data, which is what makes them
 * readable and lets the tests assert on the parsed result.
 */
function toPlist(value, indent = '  ') {
  if (value instanceof PlistInt) return `${indent}<integer>${value.value}</integer>`;
  if (typeof value === 'boolean') return `${indent}<${value}/>`;
  if (typeof value === 'number') return `${indent}<real>${value}</real>`;
  if (typeof value === 'string') return `${indent}<string>${escapeXml(value)}</string>`;

  if (Array.isArray(value)) {
    if (!value.length) return `${indent}<array/>`;
    const items = value.map((v) => toPlist(v, indent + '  ')).join('\n');
    return `${indent}<array>\n${items}\n${indent}</array>`;
  }

  const entries = Object.entries(value);
  if (!entries.length) return `${indent}<dict/>`;
  const body = entries
    .map(
      ([key, v]) =>
        `${indent}  <key>${escapeXml(key)}</key>\n${toPlist(v, indent + '  ')}`
    )
    .join('\n');
  return `${indent}<dict>\n${body}\n${indent}</dict>`;
}

/** Uppercase UUID, the casing Shortcuts writes. */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    })
    .toUpperCase();
}

/* -------------------------- variables and actions -------------------------- */

/** A reference to an earlier action's output. */
const output = (actionUuid, name) => ({
  Type: 'ActionOutput',
  OutputUUID: actionUuid,
  OutputName: name,
});

/** A parameter that is entirely one variable, e.g. an action's WFInput. */
const attachment = (ref) => ({
  WFSerializationType: 'WFTextTokenAttachment',
  Value: ref,
});

/**
 * A string parameter with variables embedded in it.
 *
 * Each part is either a literal string or a variable reference; the offsets are
 * computed from the assembled text so they cannot drift out of step with it.
 */
function tokenString(parts) {
  let string = '';
  const attachmentsByRange = {};
  for (const part of parts) {
    if (typeof part === 'string') {
      string += part;
      continue;
    }
    attachmentsByRange[`{${string.length}, 1}`] = part;
    string += PLACEHOLDER;
  }
  const value = Object.keys(attachmentsByRange).length
    ? { string, attachmentsByRange }
    : { string };
  return { WFSerializationType: 'WFTextTokenString', Value: value };
}

/** Plain text, or a whole variable, as one entry in a JSON request body. */
function jsonField(key, valueParts) {
  return {
    WFItemType: int(0), // 0 = Text
    WFKey: tokenString([key]),
    WFValue: tokenString(valueParts),
  };
}

const action = (identifier, parameters) => ({
  WFWorkflowActionIdentifier: identifier,
  WFWorkflowActionParameters: parameters,
});

/** Wrap a finished action list in the workflow envelope. */
function workflow(actions, { glyph = 59761, colour = 4292093695 } = {}) {
  const plist = {
    WFWorkflowClientVersion: '2605.0.5',
    // Present in every shortcut the app itself exports. Omitting them still
    // imports, but `shortcuts sign` is stricter than the importer about being
    // handed something that looks like a genuine export.
    WFWorkflowClientRelease: '2.1.2',
    WFWorkflowMinimumClientVersion: int(900),
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFQuickActionSurfaces: [],
    WFWorkflowIcon: {
      WFWorkflowIconGlyphNumber: int(glyph),
      WFWorkflowIconStartColor: int(colour),
    },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ['NCWidget', 'WatchKit'],
    WFWorkflowInputContentItemClasses: [
      'WFAppStoreAppContentItem',
      'WFArticleContentItem',
      'WFContactContentItem',
      'WFDateContentItem',
      'WFEmailAddressContentItem',
      'WFGenericFileContentItem',
      'WFImageContentItem',
      'WFiTunesProductContentItem',
      'WFLocationContentItem',
      'WFDCMapsLinkContentItem',
      'WFAVAssetContentItem',
      'WFPDFContentItem',
      'WFPhoneNumberContentItem',
      'WFRichTextContentItem',
      'WFSafariWebPageContentItem',
      'WFStringContentItem',
      'WFURLContentItem',
    ],
    WFWorkflowActions: actions,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${toPlist(plist)}
</plist>
`;
}

/* ------------------------------- shortcuts ------------------------------- */

/**
 * The original two-prompt version: type an amount, it lands in your last group.
 *
 * Kept because it is the one that still works when you are in a hurry, and
 * because a shorter action list is a smaller surface for an iOS update to
 * break.
 */
export function buildQuickAddShortcut({ baseUrl, token, name = 'Log expense' }) {
  const ask = uuid();
  const get = uuid();
  const message = uuid();

  return workflow([
    action('is.workflow.actions.ask', {
      UUID: ask,
      WFAskActionPrompt: name === 'Log expense' ? 'Amount' : name,
      WFInputType: 'Number',
    }),
    action('is.workflow.actions.downloadurl', {
      UUID: get,
      WFHTTPMethod: 'GET',
      ShowHeaders: false,
      WFURL: tokenString([
        `${baseUrl}/quick-add?token=${encodeURIComponent(token)}&amount=`,
        output(ask, 'Provided Input'),
      ]),
    }),
    // Pull out the one sentence worth reading. Showing the response directly
    // put the entire JSON object on screen — id, splits and all — as the
    // confirmation for a two-tap action.
    action('is.workflow.actions.getvalueforkey', {
      UUID: message,
      WFInput: attachment(output(get, 'Contents of URL')),
      WFDictionaryKey: 'message',
      WFGetDictionaryValueType: 'Value',
    }),
    action('is.workflow.actions.showresult', {
      Text: tokenString([output(message, 'Dictionary Value')]),
    }),
  ]);
}

/**
 * The full version: where, category, amount, description, note.
 *
 * The two lists are fetched when it runs rather than baked in, so a group
 * created after the import still appears. The expense is POSTed as JSON
 * because Shortcuts does not percent-encode variables dropped into a URL, and
 * a note containing "&" would otherwise truncate the request.
 */
export function buildFullShortcut({ baseUrl, token }) {
  const options = uuid();
  const groupsKey = uuid();
  const groupPick = uuid();
  const catsKey = uuid();
  const catPick = uuid();
  const amount = uuid();
  const description = uuid();
  const note = uuid();
  const post = uuid();
  const message = uuid();

  const dictionaryValue = (id, key, source) =>
    action('is.workflow.actions.getvalueforkey', {
      UUID: id,
      WFInput: attachment(source),
      WFDictionaryKey: key,
      WFGetDictionaryValueType: 'Value',
    });

  const chooseFrom = (id, source, prompt) =>
    action('is.workflow.actions.choosefromlist', {
      UUID: id,
      WFInput: attachment(source),
      WFChooseFromListActionPrompt: prompt,
      WFChooseFromListActionSelectMultiple: false,
    });

  const ask = (id, prompt, type) =>
    action('is.workflow.actions.ask', {
      UUID: id,
      WFAskActionPrompt: prompt,
      WFInputType: type,
      WFAskActionDefaultAnswer: '',
    });

  return workflow([
    action('is.workflow.actions.downloadurl', {
      UUID: options,
      WFHTTPMethod: 'GET',
      ShowHeaders: false,
      WFURL: `${baseUrl}/quick-add/options?token=${encodeURIComponent(token)}`,
    }),

    // Both lists come out of the same response, so each key reads from the
    // fetch rather than from whatever the previous action happened to leave
    // behind — the mistake that makes the category picker offer your own answer.
    dictionaryValue(groupsKey, 'groups', output(options, 'Contents of URL')),
    chooseFrom(groupPick, output(groupsKey, 'Dictionary Value'), 'Where?'),
    dictionaryValue(catsKey, 'categories', output(options, 'Contents of URL')),
    chooseFrom(catPick, output(catsKey, 'Dictionary Value'), 'Category?'),

    ask(amount, 'Amount', 'Number'),
    ask(description, 'What was it for?', 'Text'),
    ask(note, 'Note (optional)', 'Text'),

    action('is.workflow.actions.downloadurl', {
      UUID: post,
      WFURL: `${baseUrl}/quick-add`,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'JSON',
      ShowHeaders: false,
      WFJSONValues: {
        WFSerializationType: 'WFDictionaryFieldValue',
        Value: {
          WFDictionaryFieldValueItems: [
            jsonField('token', [token]),
            jsonField('amount', [output(amount, 'Provided Input')]),
            jsonField('group', [output(groupPick, 'Chosen Item')]),
            jsonField('category', [output(catPick, 'Chosen Item')]),
            jsonField('description', [output(description, 'Provided Input')]),
            jsonField('note', [output(note, 'Provided Input')]),
          ],
        },
      },
    }),

    // Show the server's own sentence rather than the raw JSON: it names the
    // group, which is the one thing worth double-checking at a glance.
    dictionaryValue(message, 'message', output(post, 'Contents of URL')),
    action('is.workflow.actions.showresult', {
      Text: tokenString([output(message, 'Dictionary Value')]),
    }),
  ]);
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { buildFullShortcut, buildQuickAddShortcut } from '../shortcut.js';

const BASE = 'https://example.ts.net:10000/api';
const TOKEN = 'tok_AbC-123_xyz';

/**
 * Parse the generated plist the way iOS would, and hand it back as JSON.
 *
 * Python's plistlib is a real plist parser, so this catches malformed XML,
 * bad nesting and wrong value types — the failures that would otherwise show
 * up as "cannot import this shortcut" on a phone that is not in this room.
 */
function parsePlist(xml) {
  const out = execFileSync(
    'python3',
    ['-c', 'import plistlib,sys,json; sys.stdout.write(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'],
    { input: xml, encoding: 'utf8' }
  );
  return JSON.parse(out);
}

const PLACEHOLDER = '￼';

/** Every attachment in the workflow, with the action index that holds it. */
function collectAttachments(actions) {
  const found = [];
  const walk = (node, actionIndex) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, actionIndex);
      return;
    }
    if (node.Type === 'ActionOutput') found.push({ ref: node, actionIndex });
    // A token string carries its attachments keyed by character offset; check
    // each offset really lands on a placeholder in the accompanying text.
    if (typeof node.string === 'string' && node.attachmentsByRange) {
      for (const range of Object.keys(node.attachmentsByRange)) {
        const offset = Number(range.match(/\{(\d+),/)[1]);
        assert.equal(
          node.string[offset],
          PLACEHOLDER,
          `offset ${offset} in ${JSON.stringify(node.string)} is not a placeholder`
        );
      }
      // And that no placeholder is left without an attachment pointing at it.
      const placeholders = [...node.string].filter((ch) => ch === PLACEHOLDER).length;
      assert.equal(
        placeholders,
        Object.keys(node.attachmentsByRange).length,
        `unattached placeholder in ${JSON.stringify(node.string)}`
      );
    }
    for (const value of Object.values(node)) walk(value, actionIndex);
  };
  actions.forEach((a, i) => walk(a, i));
  return found;
}

/** Shared structural rules both shortcuts must satisfy. */
function assertWellFormed(xml) {
  const plist = parsePlist(xml);
  const actions = plist.WFWorkflowActions;
  assert.ok(Array.isArray(actions) && actions.length > 0);

  const uuidToIndex = new Map();
  actions.forEach((a, i) => {
    const id = a.WFWorkflowActionParameters?.UUID;
    if (id) {
      assert.equal(uuidToIndex.has(id), false, `duplicate UUID ${id}`);
      uuidToIndex.set(id, i);
    }
    assert.match(a.WFWorkflowActionIdentifier, /^is\.workflow\.actions\./);
  });

  for (const { ref, actionIndex } of collectAttachments(actions)) {
    assert.ok(
      uuidToIndex.has(ref.OutputUUID),
      `attachment points at unknown action ${ref.OutputUUID}`
    );
    // A variable can only reference something already produced; a forward
    // reference imports fine and then resolves to nothing at run time.
    assert.ok(
      uuidToIndex.get(ref.OutputUUID) < actionIndex,
      `action ${actionIndex} references a later action`
    );
  }
  return plist;
}

test('the quick shortcut is a valid plist with correct variable wiring', () => {
  const plist = assertWellFormed(buildQuickAddShortcut({ baseUrl: BASE, token: TOKEN }));
  const ids = plist.WFWorkflowActions.map((a) => a.WFWorkflowActionIdentifier);
  assert.deepEqual(ids, [
    'is.workflow.actions.ask',
    'is.workflow.actions.downloadurl',
    'is.workflow.actions.getvalueforkey',
    'is.workflow.actions.showresult',
  ]);
  const url = plist.WFWorkflowActions[1].WFWorkflowActionParameters.WFURL.Value.string;
  assert.ok(url.startsWith(`${BASE}/quick-add?token=${encodeURIComponent(TOKEN)}&amount=`));
  // It shows the server's sentence, not the whole JSON response.
  assert.equal(
    plist.WFWorkflowActions[2].WFWorkflowActionParameters.WFDictionaryKey,
    'message'
  );
});

test('the full shortcut asks for group, category, amount, description and note', () => {
  const plist = assertWellFormed(buildFullShortcut({ baseUrl: BASE, token: TOKEN }));
  const actions = plist.WFWorkflowActions;
  const ids = actions.map((a) => a.WFWorkflowActionIdentifier);

  assert.deepEqual(ids, [
    'is.workflow.actions.downloadurl', // fetch the lists
    'is.workflow.actions.getvalueforkey', // groups
    'is.workflow.actions.choosefromlist',
    'is.workflow.actions.getvalueforkey', // categories
    'is.workflow.actions.choosefromlist',
    'is.workflow.actions.ask', // amount
    'is.workflow.actions.ask', // description
    'is.workflow.actions.ask', // note
    'is.workflow.actions.downloadurl', // create it
    'is.workflow.actions.getvalueforkey', // message
    'is.workflow.actions.showresult',
  ]);

  const prompts = actions
    .filter((a) => a.WFWorkflowActionIdentifier === 'is.workflow.actions.ask')
    .map((a) => a.WFWorkflowActionParameters.WFAskActionPrompt);
  assert.deepEqual(prompts, ['Amount', 'What was it for?', 'Note (optional)']);
  assert.equal(
    actions[5].WFWorkflowActionParameters.WFInputType,
    'Number',
    'the amount prompt should show a number pad'
  );
});

test('both dictionary lookups read from the fetch, not from each other', () => {
  const plist = assertWellFormed(buildFullShortcut({ baseUrl: BASE, token: TOKEN }));
  const actions = plist.WFWorkflowActions;
  const fetchUuid = actions[0].WFWorkflowActionParameters.UUID;

  for (const index of [1, 3]) {
    const params = actions[index].WFWorkflowActionParameters;
    assert.equal(
      params.WFInput.Value.OutputUUID,
      fetchUuid,
      `lookup at ${index} must read the options response`
    );
  }
  assert.equal(actions[1].WFWorkflowActionParameters.WFDictionaryKey, 'groups');
  assert.equal(actions[3].WFWorkflowActionParameters.WFDictionaryKey, 'categories');

  // Each picker takes the list its own lookup produced.
  assert.equal(
    actions[2].WFWorkflowActionParameters.WFInput.Value.OutputUUID,
    actions[1].WFWorkflowActionParameters.UUID
  );
  assert.equal(
    actions[4].WFWorkflowActionParameters.WFInput.Value.OutputUUID,
    actions[3].WFWorkflowActionParameters.UUID
  );
});

test('the POST body carries all six fields, wired to the right prompts', () => {
  const plist = assertWellFormed(buildFullShortcut({ baseUrl: BASE, token: TOKEN }));
  const actions = plist.WFWorkflowActions;
  const post = actions[8].WFWorkflowActionParameters;

  assert.equal(post.WFHTTPMethod, 'POST');
  assert.equal(post.WFHTTPBodyType, 'JSON');
  // A query string would be wrong here: Shortcuts does not escape what it
  // substitutes, so an "&" in the note would truncate the request.
  assert.equal(post.WFURL, `${BASE}/quick-add`);

  const items = post.WFJSONValues.Value.WFDictionaryFieldValueItems;
  const keys = items.map((i) => i.WFKey.Value.string);
  assert.deepEqual(keys, ['token', 'amount', 'group', 'category', 'description', 'note']);

  const byKey = Object.fromEntries(items.map((i) => [i.WFKey.Value.string, i.WFValue.Value]));
  // The token is a literal; everything else is a variable.
  assert.equal(byKey.token.string, TOKEN);
  assert.equal(byKey.token.attachmentsByRange, undefined);

  const uuidAt = (i) => actions[i].WFWorkflowActionParameters.UUID;
  const sourceOf = (key) => Object.values(byKey[key].attachmentsByRange)[0].OutputUUID;
  assert.equal(sourceOf('amount'), uuidAt(5));
  assert.equal(sourceOf('description'), uuidAt(6));
  assert.equal(sourceOf('note'), uuidAt(7));
  assert.equal(sourceOf('group'), uuidAt(2), 'group comes from the first picker');
  assert.equal(sourceOf('category'), uuidAt(4), 'category comes from the second');
});

test('a token with XML-significant characters is escaped, not injected', () => {
  const nasty = 'a&b<c>d"e';
  const xml = buildFullShortcut({ baseUrl: BASE, token: nasty });
  assert.equal(xml.includes('a&b<c>'), false, 'raw markup leaked into the plist');
  const plist = assertWellFormed(xml);
  const items =
    plist.WFWorkflowActions[8].WFWorkflowActionParameters.WFJSONValues.Value
      .WFDictionaryFieldValueItems;
  // Round-trips back to exactly what went in.
  assert.equal(items[0].WFValue.Value.string, nasty);
});

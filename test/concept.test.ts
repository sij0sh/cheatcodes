import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCuratedEntry,
  deriveEntryId,
  KnowledgeValidationError,
  parseKnowledgeMarkdown,
  removeEntriesFromSessions,
  renderKnowledgeMarkdown,
  validateEntry,
  type KnowledgeEntry,
} from "../src/concept.js";

function entry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "cc-aaaaaaaaaaaaaaaaaaaaaaaa",
    title: "Use repository adapter",
    summary: "All persistence goes through the repository adapter.",
    body: "The repository adapter is the only persistence boundary.",
    ...overrides,
  };
}

test("date metadata is normalized and round trips", () => {
  const stamped = entry({ date: "2026-08-29T18:39:05Z" });
  const markdown = renderKnowledgeMarkdown([stamped]);
  assert.match(markdown, /"date":"2026-08-29T18:39:05\.000Z"/);
  assert.deepEqual(parseKnowledgeMarkdown(markdown), [{ ...stamped, date: "2026-08-29T18:39:05.000Z" }]);
  const plain = renderKnowledgeMarkdown([entry()]);
  assert.equal(plain.includes('"date"'), false);
});

test("invalid date metadata is rejected", () => {
  assert.throws(() => validateEntry(entry({ date: "not-a-date" })), KnowledgeValidationError);
  assert.throws(() => validateEntry(entry({ date: 42 })), KnowledgeValidationError);
});

test("parse and render round trip", () => {
  const entries = [entry(), entry({ id: "cc-bbbbbbbbbbbbbbbbbbbbbbbb", title: "Zebra entry", body: "Second body." })];
  const parsed = parseKnowledgeMarkdown(renderKnowledgeMarkdown(entries));
  assert.deepEqual(parsed, entries);
});

test("render is deterministic and sorts by normalized title then id", () => {
  const entries = [
    entry({ id: "cc-2", title: "Same title" }),
    entry({ id: "cc-1", title: "Same title", body: "Other." }),
    entry({ id: "cc-0", title: "ALPHA TITLE", summary: "Case folding." }),
  ];
  const first = renderKnowledgeMarkdown(entries);
  const second = renderKnowledgeMarkdown([...entries].reverse());
  assert.equal(first, second);
  const order = parseKnowledgeMarkdown(first).map((item) => item.id);
  assert.deepEqual(order, ["cc-0", "cc-1", "cc-2"]);
});

test("unchanged entries render identical bytes", () => {
  const rendered = renderKnowledgeMarkdown([entry()]);
  const reparsed = parseKnowledgeMarkdown(rendered);
  assert.equal(renderKnowledgeMarkdown(reparsed), rendered);
});

test("empty document renders a heading only", () => {
  assert.equal(renderKnowledgeMarkdown([]), "# CHEATCODES\n");
  assert.deepEqual(parseKnowledgeMarkdown("# CHEATCODES\n"), []);
});

test("malformed metadata is rejected", () => {
  const broken = "# CHEATCODES\n\n<!-- cheatcodes-entry {not json} -->\n## T\n\nS\n\nB\n\n<!-- /cheatcodes-entry -->\n";
  assert.throws(() => parseKnowledgeMarkdown(broken), KnowledgeValidationError, /valid JSON/);
});

test("unterminated entries are rejected", () => {
  const broken = "# CHEATCODES\n\n<!-- cheatcodes-entry {} -->\nno closing marker";
  assert.throws(() => parseKnowledgeMarkdown(broken), KnowledgeValidationError);
});

function renderBlockFor(item: KnowledgeEntry): string {
  const document = renderKnowledgeMarkdown([item]);
  return document.slice("# CHEATCODES\n\n".length).trimEnd();
}

test("duplicate ids are rejected", () => {
  const rendered = [
    "# CHEATCODES",
    "",
    renderBlockFor(entry()),
    renderBlockFor(entry({ body: "Different body." })),
  ].join("\n");
  assert.throws(() => parseKnowledgeMarkdown(rendered), KnowledgeValidationError, /duplicate entry id/);
});

test("reserved delimiters are rejected", () => {
  assert.throws(
    () => renderKnowledgeMarkdown([entry({ body: "text <!-- /cheatcodes-entry --> more" })]),
    KnowledgeValidationError,
  );
  assert.throws(() => renderKnowledgeMarkdown([entry({ summary: "uses --> inside" })]), KnowledgeValidationError);
});

test("validation requires non-empty strict fields", () => {
  assert.throws(() => renderKnowledgeMarkdown([entry({ title: "   " })]), KnowledgeValidationError);
  assert.throws(() => renderKnowledgeMarkdown([{ ...entry(), summary: 42 }]), KnowledgeValidationError);
  assert.throws(() => renderKnowledgeMarkdown([entry({ id: "bad id!" })]), KnowledgeValidationError);
});

test("tags and sources are sorted and deduplicated", () => {
  const rendered = renderKnowledgeMarkdown([
    entry({ tags: ["b", "a", "b"], sources: ["s2", "s1", "s2"] }),
  ]);
  const parsed = parseKnowledgeMarkdown(rendered)[0]!;
  assert.deepEqual(parsed.tags, ["a", "b"]);
  assert.deepEqual(parsed.sources, ["s1", "s2"]);
});

test("entries sourced from foreign sessions are removed without affecting project entries", () => {
  const local = entry({ sources: ["session:local#records=u1"] });
  const foreign = entry({ id: "cc-foreign", title: "Foreign", sources: ["session:foreign#records=u2"] });
  const mixed = entry({ id: "cc-mixed", title: "Mixed", sources: ["session:local#records=u3", "session:foreign#records=u4"] });
  const untracked = entry({ id: "cc-untracked", title: "Untracked", sources: ["manual"] });
  const result = removeEntriesFromSessions([local, foreign, mixed, untracked], ["foreign"]);
  assert.equal(result.removed, 2);
  assert.deepEqual(result.entries.map((item) => item.id), [local.id, untracked.id]);
});

test("line endings and trailing whitespace are normalized", () => {
  const rendered = renderKnowledgeMarkdown([entry({ body: "line one  \r\nline two\t\r\n" })]);
  const parsed = parseKnowledgeMarkdown(rendered)[0]!;
  assert.equal(parsed.body, "line one\nline two");
});

test("deriveEntryId is deterministic and title-normalized", () => {
  const base = deriveEntryId("git:abc", "Use  The Adapter");
  assert.equal(base, deriveEntryId("git:abc", "use the adapter"));
  assert.match(base, /^cc-[0-9a-f]{24}$/);
  assert.notEqual(base, deriveEntryId("git:def", "Use The Adapter"));
  assert.notEqual(base, deriveEntryId("git:abc", "Other title"));
});

test("create is idempotent on replay and merges sources", () => {
  const projectKey = "git:abc";
  const first = applyCuratedEntry([], {
    action: "create",
    title: "Use repository adapter",
    summary: "One.",
    body: "Body one.",
    sources: ["session:s1#records=r1"],
  }, projectKey);
  assert.equal(first.changed, true);
  const second = applyCuratedEntry(first.entries, {
    action: "create",
    title: "Use repository adapter",
    summary: "One.",
    body: "Body one.",
    sources: ["session:s1#records=r1", "session:s2#records=r9"],
  }, projectKey);
  assert.equal(second.changed, true);
  assert.deepEqual(second.entries[0]!.sources, ["session:s1#records=r1", "session:s2#records=r9"]);
  const third = applyCuratedEntry(second.entries, {
    action: "create",
    title: "Use repository adapter",
    summary: "One.",
    body: "Body one.",
    sources: ["session:s1#records=r1", "session:s2#records=r9"],
  }, projectKey);
  assert.equal(third.changed, false);
  assert.deepEqual(third.entries, second.entries);
});

test("create id collision with a different normalized title fails", () => {
  const projectKey = "git:abc";
  const title = "Shared prefix";
  const first = applyCuratedEntry([], { action: "create", title, summary: "S", body: "B" }, projectKey);
  const handEdited = entry({
    id: first.id,
    title: "Different title",
    summary: "Hand-edited.",
    body: "Hand-edited body.",
  });
  assert.throws(
    () => applyCuratedEntry([handEdited], { action: "create", title, summary: "S", body: "B" }, projectKey),
    (error: unknown) => error instanceof KnowledgeValidationError && /already belongs/.test(error.message),
  );
});

test("update replaces the complete entry and preserves the id", () => {
  const projectKey = "git:abc";
  const created = applyCuratedEntry([], {
    action: "create",
    title: "Old title",
    summary: "Old summary.",
    body: "Old body with obsolete text and addenda.",
    tags: ["old"],
    sources: ["session:s1#records=r1"],
  }, projectKey);
  const id = created.id;
  const updated = applyCuratedEntry(created.entries, {
    action: "update",
    targetEntryId: id,
    title: "New title",
    summary: "New summary.",
    body: "Complete replacement body.",
    tags: ["new"],
  }, projectKey);
  assert.equal(updated.changed, true);
  assert.equal(updated.entries[0]!.id, id);
  assert.equal(updated.entries.length, 1);
  const text = renderKnowledgeMarkdown(updated.entries);
  assert.equal(text.includes("obsolete"), false);
  assert.equal(text.includes("New title"), true);
  assert.deepEqual(updated.entries[0]!.tags, ["new", "old"]);
});

test("update requires an existing target", () => {
  assert.throws(
    () => applyCuratedEntry([], { action: "update", targetEntryId: "cc-missing", title: "T", summary: "S", body: "B" }, "git:abc"),
    KnowledgeValidationError,
  );
});

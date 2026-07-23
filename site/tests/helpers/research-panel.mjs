import assert from "node:assert/strict";

const normalizeMarkup = (markup) =>
  markup
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

export function assertResearchPanelHeader(
  html,
  { view, eyebrow, title, action = null },
) {
  const headers =
    html.match(
      /<header\b[^>]*class="security-research-panel-header"[^>]*>[\s\S]*?<\/header>/gi,
    ) ?? [];
  assert.equal(headers.length, 1, "expected one shared research panel header");

  const header = normalizeMarkup(headers[0]);
  const titleId = `research-panel-heading-${view}`;
  assert.ok(header.includes(`data-research-panel="${view}"`));
  assert.ok(header.includes(`aria-labelledby="${titleId}"`));
  assert.ok(
    header.includes(
      `<h2 class="security-research-panel-header__title" id="${titleId}">${title}</h2>`,
    ),
  );
  assert.ok(
    header.includes(
      `<p class="security-research-panel-header__eyebrow">${eyebrow}</p>`,
    ),
  );
  assert.match(
    header,
    /<p class="security-research-panel-header__body">[^<]+<\/p>/,
  );

  const eyebrowIndex = header.indexOf(
    'class="security-research-panel-header__eyebrow"',
  );
  const titleIndex = header.indexOf(
    'class="security-research-panel-header__title"',
  );
  const bodyIndex = header.indexOf(
    'class="security-research-panel-header__body"',
  );
  assert.ok(eyebrowIndex < titleIndex && titleIndex < bodyIndex);

  const actions = header.match(
    /class="security-research-panel-header__actions"/g,
  );
  if (action === null) {
    assert.equal(actions, null);
    return;
  }

  assert.equal(actions?.length, 1);
  assert.ok(header.includes(action));
  assert.match(
    header,
    /<button\b[^>]*class="security-research-panel-header__action"[^>]*disabled=""/,
  );
}

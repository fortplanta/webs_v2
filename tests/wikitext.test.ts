import { describe, expect, it } from 'vitest';
import { cleanWikitext, isDisambiguation, isRedirect, toPassages } from '../src/backend/library/wikitext';

describe('cleanWikitext', () => {
  it('keeps prose and link labels; drops templates, refs, comments, media and categories', () => {
    const raw = `{{Short description|Airship}}
{{Infobox aircraft | name = LZ 1 | note = {{nested|x}} }}
A '''zeppelin''' is a type of [[airship|rigid airship]] named after [[Ferdinand von Zeppelin|Count Zeppelin]].<ref name="a">Some cite</ref><ref name=b/> It was <!-- hidden -->first flown in [[1900]].
[[File:LZ1.jpg|thumb|The first [[LZ 1]] flying]]
[[Category:Airships]]
[[fr:Zeppelin]]`;
    expect(cleanWikitext(raw)).toBe('A zeppelin is a type of rigid airship named after Count Zeppelin. It was first flown in 1900.');
  });

  it('turns headings into section markers and lists into dashes; removes tables and external-link syntax', () => {
    const raw = `Intro text.\n\n== History ==\nIn 1900 &amp; later.\n{| class="wikitable"\n|-\n| cell\n|}\n* one\n* two\nSee [http://example.com the site] and [http://x.org].\n=== Early years ===\nMore.`;
    const out = cleanWikitext(raw);
    expect(out).toContain('## History');
    expect(out).toContain('### Early years');
    expect(out).toContain('In 1900 & later.');
    expect(out).toContain('- one\n- two');
    expect(out).toContain('See the site and .');
    expect(out).not.toMatch(/cell|wikitable|http/);
  });

  it('never leaks markup from unbalanced braces', () => {
    expect(cleanWikitext('Fine text {{broken template never closed and more')).toBe('Fine text');
  });
});

describe('toPassages', () => {
  const para = (n: number) => `Sentence about thing ${n} that is long enough to count as real content for the index.`;
  it('makes a lead passage and per-section passages, skipping boilerplate sections', () => {
    const clean = `${para(1)}\n\n## History\n\n${para(2)}\n\n## References\n\n${para(3)}\n\n## Other websites\n\n${para(4)}`;
    expect(toPassages(clean)).toEqual([{ heading: '', text: para(1) }, { heading: 'History', text: para(2) }]);
  });
  it('groups short paragraphs and splits very long ones, dropping tiny fragments', () => {
    const clean = [para(1), para(2), 'tiny', para(3)].join('\n\n');
    const p = toPassages(clean);
    expect(p).toHaveLength(1);
    expect(p[0].text).toContain(para(1)); expect(p[0].text).toContain(para(3)); expect(p[0].text).not.toContain('tiny\n');
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something quite specific.`).join(' ');
    const split = toPassages(long);
    expect(split.length).toBeGreaterThan(2);
    expect(split.every(x => x.text.length <= 1400)).toBe(true);
  });
  it('detects redirects and disambiguation pages', () => {
    expect(isRedirect('#REDIRECT [[Foo]]')).toBe(true);
    expect(isRedirect('Foo is a bar')).toBe(false);
    expect(isDisambiguation('Foo may mean:\n{{disambig}}')).toBe(true);
  });
});

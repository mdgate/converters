# mdgate/converters External Messaging

> Public messaging standard for the open-source `mdgate/converters` project.
>
> This document defines how `mdgate/converters` should be presented across GitHub, npm, search pages, runtime pages, community posts, and AI/coding-agent discovery.

---

## 1. What We Are Marketing

We are marketing:

> **mdgate/converters**

Canonical description (GitHub About, npm `description`):

> **Pure TypeScript converters for 150+ file types to Markdown, including DOCX, PDF, PPTX, XLSX, iWork, HWP, and email. Runs in Node, Edge, and browsers.**

Project message (README hero, project copy):

> **Real-world files to Markdown, in pure TypeScript.**

Longer version:

> `mdgate/converters` converts real-world files to GitHub-Flavored Markdown in pure TypeScript: PDF, Word, Excel, PowerPoint, iWork, HWP, WPS, email, and 150+ other types. It runs in Node.js, Cloudflare Workers, Edge, and browsers.

Do not collapse the project message and the canonical description into one sentence.

---

## 2. The User Does Not Start With mdgate/converters

Most users will not search for:

> mdgate/converters

They will search for a problem:

> PDF to Markdown TypeScript

> HWP parser JavaScript

> DOCX to Markdown Cloudflare Workers

> convert Apple Pages to Markdown

> read Office files in browser

> document parser without Python

Or they may ask a coding agent:

> Make this Cloudflare Worker read DOCX, PPTX and XLSX uploads.

Our job is therefore not simply to explain the project.

Our job is:

> **Be present when the problem appears.**

---

## 3. Core Acquisition Principle

Every public asset should follow:

> **Specific problem → clear answer → proof → install**

Not:

> brand story → features → architecture → maybe an answer

The user or coding agent should be able to decide quickly:

> This solves my exact problem.

---

## 4. Messaging Layers

### Project message

Use when describing the whole repository:

> **Real-world files to Markdown, in pure TypeScript.**

Supporting line:

> One format, your own set, or the complete converter collection.

### Metadata message

Use for GitHub About and npm `description`:

> **Pure TypeScript converters for 150+ file types to Markdown, including DOCX, PDF, PPTX, XLSX, iWork, HWP, and email. Runs in Node, Edge, and browsers.**

---

### Intent message

Use for search pages and package READMEs:

> Convert HWP to Markdown in JavaScript.

> Convert PDF to Markdown in Cloudflare Workers.

> Read Apple Pages files in Node.js.

> Convert PowerPoint files to Markdown in the browser.

Intent language should be concrete and specific.

---

### Proof message

Use to help a human or agent qualify the project:

> Pure TypeScript.

> Runs in Node.js.

> Runs in Cloudflare Workers.

> Runs in Edge runtimes.

> Runs in browsers.

> No Python.

> No native addons.

> No WASM.

> Zero third-party runtime dependencies.

> Outputs GitHub-Flavored Markdown.

These are proof points, not the project positioning itself.

---

## 5. Public Entry Points

### GitHub root README

Purpose:

> Explain what `mdgate/converters` is and why someone should adopt it.

It should communicate:

* real-world files → Markdown
* broad format coverage
* JavaScript-native
* modular packages
* one format / custom set / complete set
* runtime compatibility
* dependency model
* key limitations
* AI-agent and ingestion use cases

---

### `convert.mdgate.dev`

Purpose:

> Let someone convert a file immediately.

It is a working tool, not a demo.

The page should prioritize:

1. upload
2. conversion result
3. local/browser behavior
4. matching package
5. `@mdgate/converters` for broader support

Example:

> Uploaded `report.hwp`?
>
> Use it in your app:
>
> `npm install @mdgate/hwp`

---

### `mdgate.dev/{format}-to-markdown`

Examples:

* `/pdf-to-markdown`
* `/docx-to-markdown`
* `/pptx-to-markdown`
* `/hwp-to-markdown`
* `/pages-to-markdown`
* `/msg-to-markdown`

Purpose:

> Answer one search intent better than any generic product page.

The first paragraph should directly answer the query.

Example:

> `@mdgate/hwp` converts HWP and HWPX files to Markdown in JavaScript and runs in Node.js, Edge runtimes, and browsers.

Then provide:

* install
* minimal code
* supported variants
* runtime support
* format-specific behavior
* limitations
* link to the corresponding package
* link to the complete converter set

Each page must contain genuinely unique information.

---

### Runtime pages

Examples:

* `/cloudflare-workers`
* `/browser`
* `/nodejs`
* `/edge`

Purpose:

> Capture users whose main constraint is the runtime rather than the format.

Example:

> **Read PDF, DOCX, PPTX, XLSX and other documents inside Cloudflare Workers.**

These pages should explain why `mdgate/converters` fits that runtime.

---

### Package README / npm README

Purpose:

> Help someone decide whether this exact package fits their task.

Every end-user package README should be unique.

Examples:

`@mdgate/hwp`

> HWP / HWPX parsing, variants, limitations, Hancom-specific behavior.

`@mdgate/pages`

> Apple Pages, `.pages`, running outside Apple software, relevant format behavior.

`@mdgate/pptx`

> PowerPoint structure, presentation-to-Markdown behavior, supported variants.

`@mdgate/pdf`

> PDF text extraction, image-heavy PDFs, encrypted PDFs, PDF-specific limitations.

Do not create a single README template and replace only the format name.

---

## 6. Package Discovery Is a Marketing Channel

Every package is an independent discovery surface.

A user or coding agent may discover:

```text
@mdgate/pdf
@mdgate/hwp
@mdgate/pages
@mdgate/pptx
```

before knowing that `mdgate/converters` exists.

That is desirable.

The acquisition path may be:

```text
specific problem
↓
specific package
↓
successful integration
↓
discover other @mdgate packages
↓
discover @mdgate/converters
```

Therefore every package should stand on its own in:

* npm description
* README
* keywords
* examples
* limitations
* supported formats

---

## 7. Optimize for Coding Agents

Coding agents are real users of the project's public information.

A coding agent may search for a dependency, inspect npm metadata, read a README, compare constraints, and install a package without the developer manually researching alternatives.

Therefore:

> **Don't make the agent infer.**

Avoid:

> Edge compatible.

Prefer:

> Runs in Cloudflare Workers and Edge runtimes.

Avoid:

> Lightweight.

Prefer:

> No Python, native addons, or WASM.

Avoid:

> Broad Office support.

Prefer:

> Supports DOC, DOCX, XLS, XLSX, PPT, PPTX...

Avoid:

> Local-first.

Prefer:

> For locally supported formats, conversion runs inside the application without a remote parsing service.

---

## 8. What Should Be Repeated Everywhere

The following facts should be easy to discover whenever relevant:

* input is bytes / `Uint8Array`
* output is Markdown
* exact supported format(s)
* exact supported runtime(s)
* install command
* minimal example
* Python requirement: none
* native addon requirement: none
* WASM requirement: none
* important limitations

A coding agent should not need to read the entire repository to verify these.

---

## 9. What Should Not Be Repeated Everywhere

Do not force every page to contain the same brand story.

A `/hwp-to-markdown` page should mostly talk about HWP.

A `@mdgate/pdf` README should mostly talk about PDF.

A Cloudflare Workers page should mostly talk about Workers.

The project identity should connect these pages, not dominate them.

---

## 10. Canonical Vocabulary

Prefer:

> `mdgate/converters`

when referring to the project.

Prefer:

> real-world files

over:

> any file

Prefer:

> converts files to Markdown

for search intent.

Prefer:

> file-reading capability

when discussing AI-agent use cases.

Prefer:

> zero third-party runtime dependencies

over:

> zero dependencies

Prefer:

> locally parsed

when that is factually true.

---

## 11. Claims We Should Avoid

Do not claim without evidence:

* best
* fastest
* most accurate
* universal
* every file
* perfect conversion

Do not present media conversion as deterministic parsing if it depends on an external model.

---

## 12. Canonical Funnel

Human:

```text
“How do I convert HWP to Markdown in JavaScript?”
↓
/hwp-to-markdown
↓
@mdgate/hwp
↓
verify support and limitations
↓
npm install
↓
discover @mdgate/converters
```

Coding agent:

```text
“Add DOCX, PPTX and XLSX support to this Cloudflare Worker.”
↓
search
↓
mdgate runtime page / npm package / README
↓
TypeScript ✓
Workers ✓
formats ✓
Markdown ✓
no native runtime ✓
↓
install
```

---

## 13. Final Standard

The objective is:

> **When a developer or coding agent needs to turn a real-world file into Markdown inside a JavaScript runtime, mdgate/converters or one of its packages should be easy to find, easy to verify, and easy to choose.**

Everything we publish for `mdgate/converters` should serve that goal.

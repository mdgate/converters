# mdgate/converters Product Thesis

> Internal product strategy document for the open-source `mdgate/converters` project.
> This document defines why `mdgate/converters` exists, what problem it solves, how the project should be shaped, and which principles should remain stable as it evolves.

---

## 1. Product Thesis

Agents increasingly need to read the real-world files users give them, not only text files.

`mdgate/converters` provides the file-reading layer between those files and the Agent, inside the JavaScript runtime the Agent already uses.

The project follows a simple division of responsibility:

* Deterministic document formats should be parsed by software.
* Images, audio, and video should reuse the Agent's existing multimodal model.
* Developers should be able to install one converter, compose exactly the reader they need, or use the complete converter set.
* The runtime should remain pure TypeScript, modular, dependency-light, portable, and suitable for local, serverless, browser, and Edge production.

`mdgate/converters` should not become a heavyweight document-processing platform.

It should make file reading feel like a native capability of the Agent.

---

## 2. The Problem

Modern Agents commonly expose primitives such as:

* `read_file`
* `write_file`
* `grep`
* `search`
* `shell`
* `browser`

But in practice, `read_file` often means:

> read text files, plus a few model-native multimodal formats.

Real users and enterprises work with much more than text:

* PDF
* DOCX
* PPTX
* XLSX
* Pages
* Numbers
* Keynote
* HWP
* WPS
* MSG / EML
* OneNote
* Visio
* EPUB
* archives
* images
* audio
* video
* and many other business file formats

Without a unified file-reading layer, Agent developers usually have to assemble a document-processing stack from multiple parsers, runtimes, services, binaries, or model-specific integrations.

That creates five recurring problems:

1. **Fragmentation** — every format needs a different parser or tool.
2. **Infrastructure weight** — Python, native binaries, WASM, sidecars, or parsing services are often introduced just to read files.
3. **Runtime mismatch** — modern Agent applications increasingly run in TypeScript, serverless, browser, and Edge environments.
4. **Duplicated AI infrastructure** — image, audio, and video pipelines are rebuilt even though the Agent's model already understands them.
5. **Supply-chain and enterprise risk** — large transitive dependency trees expand the trust surface of already high-privilege Agent systems.

`mdgate/converters` exists to remove this complexity.

---

## 3. Strategic Advantage Map

|  # | User need                                                                    | `mdgate/converters` provides                                                    | Strategic advantage                                                           |
| -: | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
|  1 | Agents must read real-world files, not only text                             | A unified file-reading layer                                                    | **One `read_file` for the real world**                                        |
|  2 | Agents should not know which parser handles each format                      | A common bytes-to-Markdown model                                                | **File-format complexity is pushed below the Agent layer**                    |
|  3 | Developers should not rebuild OCR, ASR, vision, and video stacks             | Images, audio, and video reuse the Agent's existing multimodal model            | **No second AI stack**                                                        |
|  4 | Business documents should be read predictably and cheaply                    | Deterministic local parsing for document formats                                | **Software parses; models understand**                                        |
|  5 | Real files include far more than PDF and DOCX                                | Broad support across office, iWork, email, notebooks, ebooks, and other formats | **Coverage designed for real-world filesystems**                              |
|  6 | A developer who only needs PDF should not ship an entire document stack      | `@mdgate/pdf` and other single-format packages                                  | **Install only what you need**                                                |
|  7 | An Agent may need only a custom subset of formats                            | `@mdgate/core` + `create([...])`                                                | **Compose exactly the reader you need**                                       |
|  8 | A general-purpose Agent needs broad file support immediately                 | `@mdgate/converters`                                                            | **One complete reader when you need everything**                              |
|  9 | Edge and serverless runtimes reward small, focused deployments               | Granular packages and composable converters                                     | **Ship only the file-reading capability required by the runtime**             |
| 10 | Modern Agent applications are commonly built in TypeScript/JavaScript        | Pure TypeScript implementation                                                  | **File reading stays inside the Agent runtime**                               |
| 11 | Local development and production should use the same implementation          | Node, browser, Workers, and other JS runtimes                                   | **Local-to-production without changing stacks**                               |
| 12 | Developers do not want hidden package forests behind a simple import         | Zero third-party runtime package dependencies                                   | **Nothing unrelated hiding behind the import**                                |
| 13 | Teams should not need Python just to read documents                          | No Python runtime                                                               | **One language, one runtime, one deployment model**                           |
| 14 | Edge/serverless environments should not depend on ABI/platform-specific code | No native addons                                                                | **Portable by design**                                                        |
| 15 | A file reader should not require a second execution runtime                  | No WASM runtime                                                                 | **A real JavaScript implementation, not a JS wrapper around another runtime** |
| 16 | A `read_file` capability should not require another service                  | Runs as an application dependency                                               | **File reading lives inside the Agent, not beside it**                        |
| 17 | Files may come from local FS, R2, S3, Blob, Drive, Slack, or Email           | Bytes are the primary boundary                                                  | **Storage-agnostic by design**                                                |
| 18 | Attachments and blobs may have missing or incorrect extensions               | Content-based sniffing and converter selection                                  | **Format detection belongs to deterministic software**                        |
| 19 | Containers such as ZIP or email may include nested files                     | Nested conversion can reuse the same converter registry                         | **One reading model across nested file structures**                           |
| 20 | Enterprises may have proprietary or internal formats                         | Open converter contract through `@mdgate/core`                                  | **The reading layer is extensible, not a closed format list**                 |
| 21 | Enterprise documents should not need to leave controlled infrastructure      | Local deterministic document parsing                                            | **Data can stay inside the user's infrastructure**                            |
| 22 | Browser applications may require strong privacy                              | Local browser conversion                                                        | **Files can remain on the user's device**                                     |
| 23 | Production systems need stable, repeatable parsing                           | Deterministic converters                                                        | **Reproducible Agent input**                                                  |
| 24 | Agents need to grep, search, chunk, index, cache, and cite file contents     | Markdown/text output                                                            | **Binary files become Agent-operable artifacts**                              |
| 25 | Re-reading a document should not repeatedly consume model tokens             | Parsed output can be cached                                                     | **Lower latency and model cost**                                              |
| 26 | Enterprise systems need observability and traceability                       | File → parsed Markdown → Agent input can be retained                            | **Auditability, debugging, and eval**                                         |
| 27 | High-privilege Agents should minimize software supply-chain exposure         | Zero third-party runtime dependencies                                           | **A much smaller dependency trust surface**                                   |
| 28 | Security teams do not want to audit a large transitive dependency graph      | A compact, explicit code boundary                                               | **One package to audit; no third-party dependency tree**                      |
| 29 | Enterprises want smaller SBOM, license, provenance, and CVE burdens          | Minimal runtime supply chain                                                    | **Lower operational and security overhead**                                   |
| 30 | Teams already have an approved Gemini, Claude, GPT, or enterprise model      | Pluggable multimodal callbacks                                                  | **Reuse existing AI infrastructure**                                          |
| 31 | Model capabilities will continue improving                                   | Media understanding follows the host Agent model                                | **Media support benefits automatically from better models**                   |
| 32 | Agent frameworks need primitives, not another platform                       | Thin integration around `create()` and converters                               | **Low adoption friction**                                                     |
| 33 | A project may grow from one parser into a complete Agent file reader         | Single packages → custom composition → full converters package                  | **One architecture from one format to every file**                            |

---

## 4. Product Architecture

`mdgate/converters` should remain a layered, composable system.

### 4.1 Core

`@mdgate/core`

Purpose:

> Build a file reader.

The core exposes the converter contract and composition mechanism.

Conceptually:

```ts
import { create } from "@mdgate/core";
import { pdf } from "@mdgate/pdf";
import { docx } from "@mdgate/docx";

const read = create([
  pdf(),
  docx(),
]);

const markdown = await read(bytes);
```

The core should stay small and generic.

It should coordinate conversion, not become a monolithic parser.

---

### 4.2 Single-format capabilities

Examples:

```text
@mdgate/pdf
@mdgate/docx
@mdgate/xlsx
@mdgate/pptx
@mdgate/hwp
...
```

Purpose:

> Read exactly what you need.

A developer who only needs PDF should be able to install only the PDF capability.

Single-format packages are especially important for:

* Edge runtimes
* serverless functions
* browser applications
* narrow-purpose APIs
* framework authors who want one specific capability
* environments where bundle size and dependency surface matter

They are also independent discovery surfaces: a developer or coding Agent may find `@mdgate/hwp` or `@mdgate/pdf` before discovering the complete project.

The product principle is:

> **Need one format? Install one format.**

---

### 4.3 Custom readers

`@mdgate/core` + selected format packages

Purpose:

> Compose exactly the file reader your application needs.

Example use cases:

* Legal Agent: PDF + DOCX + Email
* Finance Agent: PDF + XLSX + CSV
* Coding Agent: text + PDF + DOCX
* Internal enterprise Agent: standard formats + proprietary converter

The product principle is:

> **Build exactly the reader you need.**

---

### 4.4 Complete reader

`@mdgate/converters`

Purpose:

> Give an Agent broad file-reading capability immediately.

This is for:

* general-purpose Agents
* Agent frameworks
* enterprise workspaces
* file ingestion systems
* applications where the user may upload many different formats

The product principle is:

> **Need everything? One package.**

---

### 4.5 Multimodal bridge

Images, audio, and video are different from deterministic document formats.

Modern multimodal models already understand these media types.

`mdgate/converters` should not create or force a second AI stack.

Instead:

```text
image ─┐
audio ─┼─> host Agent's existing multimodal model
video ─┘
```

The caller should be able to use the model it already relies on:

* Gemini
* Claude
* GPT
* an enterprise-hosted model
* a model routed through an AI gateway
* another future multimodal provider

The product principle is:

> **Reuse the Agent's model.**

---

## 5. Product Principles

These principles should guide future engineering and product decisions.

### 5.1 Software parses what software can parse

Structured file formats such as DOCX, XLSX, PPTX, HWP, Pages, and similar formats should use deterministic parsing whenever practical.

Do not spend model tokens solving a deterministic file-format problem by default.

---

### 5.2 Reuse the Agent's model

If the Agent already uses a multimodal model capable of understanding images, audio, or video, `mdgate/converters` should integrate with that capability rather than introduce another AI stack.

Do not make users maintain duplicate model infrastructure.

---

### 5.3 Ship only what the user needs

A developer who needs PDF should not pay the code, bundle, dependency, or deployment cost of unrelated formats.

Granularity is a product feature, not only a package-management detail.

---

### 5.4 Stay inside the Agent runtime

If a problem can be solved as a normal JavaScript/TypeScript library, do not require:

* Python
* native binaries
* system packages
* WASM runtimes
* sidecars
* external parsing services

The desired architecture is:

```text
Agent
└── mdgate converter
```

not:

```text
Agent
└── document-processing infrastructure
    ├── Python
    ├── binaries
    ├── WASM
    ├── sidecars
    └── external services
```

---

### 5.5 Minimize the trust surface

Agent applications frequently hold powerful credentials and capabilities.

Runtime dependencies increase the number of packages, maintainers, release pipelines, install scripts, and provenance chains that must be trusted.

Keep third-party runtime dependencies at zero whenever reasonably possible.

Zero third-party runtime dependencies does not mean zero security risk.

It means a smaller and more understandable software supply chain.

---

### 5.6 Bytes are the boundary

`mdgate/converters` should not care whether a file came from:

* local filesystem
* browser upload
* R2
* S3
* GCS
* Azure Blob
* Google Drive
* Slack
* Email
* an HTTP request
* an Agent workspace

The reading layer should operate on bytes.

Storage and parsing should remain separate concerns.

---

### 5.7 Prefer deterministic infrastructure below probabilistic reasoning

Parsing and reasoning are different jobs.

Where possible:

```text
file
↓
deterministic parsing
↓
canonical textual representation
↓
Agent reasoning
```

This improves:

* reproducibility
* caching
* debugging
* eval
* auditability
* cost

---

### 5.8 Keep the abstraction open

The official converter list should never define the limits of the architecture.

Developers must be able to register custom converters for:

* proprietary enterprise formats
* industry-specific formats
* internal exports
* experimental formats
* future formats not yet supported upstream

The goal is not:

> support every file forever inside one package.

The goal is:

> allow every file to participate in the same reading model.

---

## 6. Target Users

### 6.1 Agent framework and platform authors

They need:

> A reliable `read_file` primitive that works beyond text.

`mdgate/converters` should be easy to embed into:

* Agent runtimes
* coding Agents
* workspace products
* enterprise Agent platforms
* Agent operating systems

For these users, the project is infrastructure.

---

### 6.2 Agent application developers

They need:

> My Agent should understand the files users upload.

They should not need to design a document-processing architecture before shipping file support.

For these users, the project is a capability.

---

### 6.3 JavaScript, Edge, and serverless developers

They need:

> A portable parser that does not drag in an unrelated stack.

They may not be building an Agent at all.

They may simply need PDF, DOCX, HWP, Pages, or another real-world file converted into usable Markdown inside a JavaScript application.

For these users, single-format packages and custom composition are especially important.

For them, the project is minimal file-processing infrastructure.

---

### 6.4 Enterprise platform and security teams

They need:

* controlled data flow
* small supply chains
* reproducible behavior
* understandable dependencies
* auditable inputs
* fewer services
* fewer runtimes
* fewer moving parts

For these users, `mdgate/converters` is a smaller trust boundary.

---

### 6.5 Coding Agents as selectors

In many cases, the developer may not personally evaluate the package.

They may ask Claude Code, Codex, Cursor, or another coding Agent to solve a problem such as:

> Add DOCX, PPTX, XLSX and PDF support to this Cloudflare Worker.

The Agent may search, compare packages, inspect documentation, and install the dependency itself.

Therefore public package information should make format support, runtime support, dependencies, limitations, and installation explicit.

The project should be easy for both humans and Agents to verify and choose.

---

## 7. Competitive Frame

`mdgate/converters` should not define its competition too narrowly.

The primary competitor is not necessarily another converter.

The real alternative is often the document-processing stack a developer would otherwise assemble:

```text
PDF parser
+ DOCX parser
+ XLSX parser
+ PPTX parser
+ email parser
+ Python runtime
+ native binaries
+ WASM
+ OCR
+ ASR
+ multimodal glue
+ storage glue
+ parsing service
+ deployment infrastructure
```

`mdgate/converters` should compete against this complexity.

The strategic promise is:

> **Do not build a document-processing stack just to let your application read files.**

For Agent use cases:

> **Do not build a document-processing stack just to let your Agent read files.**

Named tools such as MarkItDown, Docling, Pandoc, or individual npm parsers may be useful comparison and discovery surfaces.

They should not define the project's identity.

---

## 8. What We Are Not

`mdgate/converters` is not:

* an Agent framework
* an LLM framework
* a RAG framework
* an OCR model
* a speech-to-text stack
* a video understanding model
* a heavyweight document intelligence platform
* a hosted parsing SaaS by default
* a monolithic parser that forces every capability into every deployment
* a replacement for the Agent's existing multimodal model

These boundaries matter.

The project should stay focused on file reading and conversion.

---

## 9. Proof Points

Marketing claims should stay grounded in product reality.

| Claim                                 | Proof                                         |
| ------------------------------------- | --------------------------------------------- |
| Pure TypeScript                       | Source implementation                         |
| Zero third-party runtime dependencies | Package manifests and dependency graph        |
| Modular                               | Independent format packages                   |
| Composable                            | `@mdgate/core` + `create()`                   |
| Complete reader                       | `@mdgate/converters`                          |
| Runs in JavaScript runtimes           | Runtime tests and supported environments      |
| Edge-compatible                       | Worker/Edge integration and tests             |
| Browser-local conversion              | Browser converter                             |
| Broad format coverage                 | Converter registry and supported-format list  |
| Extensible                            | Public converter contract                     |
| Storage-agnostic                      | Bytes-based input model                       |
| Deterministic document parsing        | Converter implementation                      |
| Reuses host multimodal model          | Image/audio/video callback design             |
| Small supply-chain surface            | Zero third-party runtime package dependencies |
| No Python                             | Runtime architecture                          |
| No native addons                      | Runtime architecture                          |
| No WASM                               | Runtime architecture                          |

When a claim cannot be demonstrated by code, tests, package metadata, or a working conversion example, it should not be presented as a product fact.

---

## 10. Canonical Product Model

The project should be explainable in three choices:

### Install one

```text
@mdgate/pdf
```

> Need one format? Install one format.

### Compose yours

```text
@mdgate/core
+ selected converters
```

> Build exactly the reader you need.

### Read everything

```text
@mdgate/converters
```

> Give your Agent broad file-reading capability.

And for native multimodal formats:

```text
image / audio / video
↓
the model your Agent already uses
```

---

## 11. Canonical Strategic Summary

### User value

> **Turn the real-world files users give you into content software and Agents can work with.**

### Agent value

> **Give Agents the ability to read real-world files beyond text.**

### Product abstraction

> **One file-reading model across real-world files.**

### Architecture

> **Install one format, compose your own reader, or use the complete converter set.**

### Division of labor

> **Parse what software should parse. Reuse the Agent's model for what models already understand.**

### Runtime strategy

> **Stay inside the JavaScript runtime the application already uses.**

### Deployment strategy

> **Ship only what the application needs, from one converter to a complete reader.**

### Security strategy

> **Keep the runtime supply chain small, explicit, and auditable.**

---

## 12. Short Form

If the entire product thesis must be compressed into a few lines:

> **`mdgate/converters` gives JavaScript applications and Agents a clean way to read real-world files as Markdown.**
>
> Install one format, compose exactly the reader you need, or use the complete converter set.
>
> Documents are parsed deterministically. Images, audio, and video reuse the application's existing multimodal model.
>
> Pure TypeScript. Zero third-party runtime dependencies. No Python, native addons, WASM, or parsing service required for deterministic formats.

---

## 13. Decision Test

Before adding a feature, dependency, runtime, or abstraction, ask:

1. Does this make applications or Agents better at reading real-world files?
2. Is this responsibility part of file reading, or does it belong to the Agent/model/storage layer?
3. Can deterministic software solve it instead of spending model intelligence?
4. Can the user's existing multimodal model solve it instead of introducing another AI stack?
5. Can a developer install only the capability they need?
6. Does this keep the converter inside the host JavaScript runtime?
7. Does this add third-party runtime dependencies or enlarge the trust surface?
8. Will this work from local development through browser, Edge, and production deployment where relevant?
9. Does it preserve the simple bytes-in, Markdown-out model?
10. Does it make the project more composable rather than more monolithic?

If the answer to several of these is no, the feature likely does not belong in `mdgate/converters`.

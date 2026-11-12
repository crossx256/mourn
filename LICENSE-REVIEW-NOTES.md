# Review notes: proposed client license 1.0

Status: **proposal only**. AGPL-3.0 remains the operative license in `LICENSE`.

## What the proposal does

- Free personal and internal business use of official clients.
- Free reading, building and private modification of the source.
- Public source forks, branches, patches and pull requests for contributing upstream.
- Contributor keeps copyright; the grant covers integration and official distribution
  only, with no assignment and no blanket right to relicense their work.
- No selling the client, no independent client binary distribution, no rebranded
  competing product, no implied endorsement.

## What it explicitly cannot do

- It cannot revoke AGPL rights already granted for published releases, including
  v1.5.4. Anyone who received that source may still exercise AGPL rights for it.
- It cannot relicense third-party components, fonts, icons or assets that carry
  their own terms.
- It cannot authorize redistribution of material whose provenance is unknown.

## Questions for the reviewer

1. Linux AppImage packaging currently can bundle GPL-licensed GStreamer plugins
   (x264, x265, a52dec, mpeg2dec). Does that make a restrictive-license binary
   distribution incompatible, and is an allowlist of LGPL/permissive codecs the
   right remedy?
2. The default cursor effect and starfield artwork have unknown provenance. Is
   removing or replacing them required before any restrictive-license release?
3. Section 4 permits contribution forks. GitHub's Terms already grant platform
   viewing and forking rights to public repositories. Is the wording accurately
   scoped so it adds a contribution permission without purporting to narrow the
   platform grant?
4. Section 5 grants maintainers integration and official-distribution rights for
   contributions. Is that sufficient for accepting pull requests, and does it stay
   clear of a copyright assignment or a broad relicensing CLA?
5. Is the "source available, not open source" description in section 1 and in
   README/NOTICE wording accurate for this text?
6. Are the trademark paragraphs (section 8) sufficient to prevent a rebranded
   competing distribution while still allowing truthful references and forks?
7. Any jurisdiction-specific concerns for enforcement of sections 6 and 9?

# OffsetAxis project page

Project page of

**OffsetAxis: UDF Mesh Reconstruction via Offset-Volume Medial Axis Extraction**
Qijia Huang, Pierre Kraemer, Dominique Bechmann (ICube, Université de Strasbourg, CNRS)
SIGGRAPH Asia 2026 · [doi:10.1145/3829340.3842256](https://doi.org/10.1145/3829340.3842256)

A static site built with [Vite](https://vite.dev). The Method section replays the pipeline in 3D
(three.js), ported from the talk slides ([OffsetAxis-talk](https://github.com/huang46u/OffsetAxis-talk),
web version <https://offsetaxis.pages.dev>).

## Run locally

Node 20 or later:

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check, then the static site in dist/
npm run preview    # serves dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`
(repository Settings → Pages → Source: GitHub Actions): <https://huang46u.github.io/OffsetAxis-Page/>.
The site uses relative paths, so it works under any sub-path.

## Layout

| Path | Content |
|---|---|
| `index.html` | the page: header, abstract, method, results, BibTeX. **Links** (arXiv, code, poster) are in the header `<nav>` |
| `src/main.ts` | header isolines, method steps (drives the 3D replay), results swipe comparison, BibTeX copy |
| `src/style.css` | palette "Field" and layout |
| `src/pipeline/` | the 3D replay (`oaPipeline.ts`) and its scene / material helpers, from the slides |
| `src/looks/oa-pipeline.json` | lights, materials and camera of the replay, tuned in the slides |
| `public/oa/pipeline/` | replay data (bunny, UDF, spheres, samples, connectivity) and the 2D fast forward frames |
| `public/img/results/aligned/` | result renders (transparent) registered on "Ours" (same canvas, object bounding boxes matched), for the swipe comparison; made by `scripts/align_results.py` from the slides' renders (`presentation/slides/public/oa/`, absolute paths in the script) |

## To do before release

- arXiv link (`data-todo="arxiv"` in `index.html`); Code and Poster buttons when they are out.
- Author homepage links (`href="#"`).

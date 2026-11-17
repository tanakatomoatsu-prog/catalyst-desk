# Catalyst Desk

A personal market desk: dated catalysts, macro readings and themes, a cross-asset chart, and a notebook.
It is a plain static site, so it runs on GitHub Pages and can be added to an iPhone home screen.

## What lives where

| Path | What it is | Who changes it |
| --- | --- | --- |
| `index.html` | The whole app | Claude, on request |
| `data/desk.json` | Market read, readings, themes, catalysts | Claude, on each refresh |
| `data/universe.json` | Instruments available in the chart | Claude, when you ask for a new one |
| `data/prices.json` | Two years of daily history per instrument | The "Update prices" workflow |
| `scripts/fetch-prices.mjs` | Price fetcher (Yahoo Finance, FRED, Japan MoF) | Claude |

Your own takes, catalysts, notes and chart choices are stored in the browser on your device, not in this
repository. Use Notebook > Download backup to keep a copy.

## One-time setup

1. Settings > Pages > Build and deployment > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
2. Settings > Actions > General > Workflow permissions: "Read and write permissions".
3. Actions > Update prices > Run workflow (it also runs on a schedule on weekdays).
4. Open the Pages address in Safari, then Share > Add to Home Screen.

## Adding an instrument

Add a line to `data/universe.json`. `src` is `yahoo` (use the Yahoo Finance symbol), `fred` (a FRED series id)
or `mof` (a JGB maturity such as `5Y`). `kind` is `price` (drawn rebased to 100) or `yield` (drawn as a level in %).
Set `"adj": true` on funds so the history includes distributions. Saving the file triggers a price run.

Price data comes from free public sources and can be late, revised or missing. It is not for trading.

// Tests de l'extraction HTML et Markdown. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { htmlVersMarkdown } from "../src/ingestion/html.ts";
import { separerEntete } from "../src/ingestion/markdown.ts";

const page = `<html><body>
<div class="bandeau-cookies">Nous utilisons des cookies. <button>Accepter</button></div>
<header><nav><a href="index.html">Accueil</a></nav></header>
<main><article><h1>Venir à vélo</h1><p>Le forfait est de <a href="transport.html">300 € par an</a>.</p></article>
<aside><h2>Liens utiles</h2></aside></main>
<footer>© 2026 Kalyo</footer></body></html>`;

test("le menu, le bandeau de cookies et le pied de page disparaissent", () => {
  assert.equal(htmlVersMarkdown(page), "# Venir à vélo\n\nLe forfait est de 300 € par an.");
});

test("un tableau reste un tableau", async () => {
  const markdown = htmlVersMarkdown(await readFile("corpus/intranet/qui-contacter.html", "utf8"));
  assert.match(markdown, /^# Qui contacter \?/);
  assert.match(markdown, /\| Votre question \| Qui contacter \| Comment \|/);
  assert.doesNotMatch(markdown, /cookies|Plan du site/);
});

test("l'en-tête YAML est séparé du texte Markdown, même dans un fichier venu de Windows", () => {
  const { entete, texte } = separerEntete("\ufeff---\r\nid: FAQ-RH\r\n---\r\n\r\n# FAQ RH\r\n");
  assert.equal(entete, "id: FAQ-RH");
  assert.equal(texte, "# FAQ RH");
  assert.equal(separerEntete("# Sans en-tête").entete, "");
});

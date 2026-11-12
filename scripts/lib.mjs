// Shared helper: runs the data part of index.html outside a browser and hands back the venue list.
import { readFileSync } from "node:fs";

export function loadApp(file = "index.html") {
  const html = readFileSync(file, "utf8");
  const js = html.split("<script>")[1].split("</script>")[0].replace(/^if\(window\.claude[\s\S]*$/m, "") + ";return {VENUES,FEATS,SPORTS,offers,winsOn};";
  const el = () => ({});
  return new Function("document", "window", "localStorage", "navigator", js)(
    { getElementById: el, querySelector: el, querySelectorAll: () => [] }, {}, { getItem: () => null, setItem() {} }, {});
}

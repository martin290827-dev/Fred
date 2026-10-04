/* Runs first, before the first paint (kept as a file, so the page can forbid inline scripts). */
// Saved day/night choice: no flash on load.
try { var t = JSON.parse(localStorage.getItem('fred.theme')); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
// Do not run inside someone else's frame (clickjacking). Fred is never meant to be embedded.
if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location; } catch (e) { /* blocked by the browser: the page stays hidden */ } }

// Applies the saved or system theme before the first paint. It is a file rather than inline
// code because the Content-Security-Policy allows no inline script. The choice is stored only
// when the visitor uses the theme toggle.
;(function () {
  try {
    var stored = localStorage.getItem('os-theme')
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    if (dark) document.documentElement.setAttribute('data-theme', 'dark')
  } catch (e) {}
})()

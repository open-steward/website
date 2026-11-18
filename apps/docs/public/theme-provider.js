// Starlight's theme provider (components/ThemeProvider.astro in @astrojs/starlight, MIT), as a
// file: the Content-Security-Policy allows no inline script. It is loaded without defer, so it
// still sets the theme before the first paint.
// Copyright (c) 2023 Astro contributors. MIT License:
// https://github.com/withastro/starlight/blob/main/LICENSE
window.StarlightThemeProvider = (function () {
  var storedTheme = typeof localStorage !== 'undefined' && localStorage.getItem('starlight-theme')
  var theme =
    storedTheme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
  return {
    updatePickers: function (next) {
      var value = next || storedTheme || 'auto'
      document.querySelectorAll('starlight-theme-select').forEach(function (picker) {
        var select = picker.querySelector('select')
        if (select) select.value = value
        var tmpl = document.querySelector('#theme-icons')
        var newIcon = tmpl && tmpl.content.querySelector('.' + value)
        if (newIcon) {
          var oldIcon = picker.querySelector('svg.label-icon')
          if (oldIcon) oldIcon.replaceChildren.apply(oldIcon, newIcon.cloneNode(true).childNodes)
        }
      })
    },
  }
})()

// Bedtime Stories: a tiny hash-routed reader. No frameworks, no build step.
(function () {
  'use strict';

  var view = document.getElementById('view');
  var FAV_KEY = 'bs.favorites';
  var MIN_SIZE = 16, MAX_SIZE = 32, DEFAULT_SIZE = 21;

  // ---------- storage (always wrapped: private tabs can throw) ----------
  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function saveRaw(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  // ---------- favorites ----------
  function getFavorites() {
    var f = load(FAV_KEY, []);
    return Array.isArray(f) ? f : [];
  }
  function isFavorite(id) { return getFavorites().indexOf(id) !== -1; }
  function toggleFavorite(id) {
    var favs = getFavorites();
    var i = favs.indexOf(id);
    if (i === -1) favs.unshift(id); else favs.splice(i, 1);
    save(FAV_KEY, favs);
    return i === -1;
  }

  // ---------- data ----------
  var indexPromise = null;
  var dayCache = {};

  function getIndex() {
    if (!indexPromise) {
      indexPromise = fetch('stories/index.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
        .then(function (data) { return data.stories || []; })
        .catch(function (e) { indexPromise = null; throw e; });
    }
    return indexPromise;
  }

  function getDay(date) {
    if (!dayCache[date]) {
      dayCache[date] = fetch('stories/' + date + '.json')
        .then(function (r) { if (!r.ok) throw new Error('day ' + r.status); return r.json(); })
        .catch(function (e) { delete dayCache[date]; throw e; });
    }
    return dayCache[date];
  }

  // ---------- tiny DOM helper (text only, never innerHTML for story content) ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') el.textContent = attrs[k];
        else if (k === 'onclick') el.addEventListener('click', attrs[k]);
        else el.setAttribute(k, attrs[k]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function render() {
    view.textContent = '';
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) view.appendChild(arguments[i]);
  }

  function formatDate(iso, long) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString(undefined, long
      ? { weekday: 'long', month: 'long', day: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function metaLine(s) {
    return 'Ages ' + s.age + ' · ' + s.minutes + ' min';
  }

  function storyItem(s, showSummary) {
    return h('li', null,
      h('a', { href: '#/story/' + s.id, text: s.title + (isFavorite(s.id) ? ' ★' : '') }),
      h('p', { class: 'meta', text: metaLine(s) }),
      showSummary && s.summary ? h('p', { class: 'summary', text: s.summary }) : null);
  }

  function showError(msg) {
    render(h('p', { class: 'quiet', text: msg || 'Could not load stories. Check your connection and try again.' }));
  }

  // ---------- views ----------
  function viewTonight() {
    getIndex().then(function (stories) {
      if (!stories.length) return render(h('h1', { text: 'No stories yet' }),
        h('p', { class: 'quiet', text: 'New stories arrive every morning.' }));
      var latest = stories[0].date;
      var todays = stories.filter(function (s) { return s.date === latest; });
      render(
        h('h1', { text: 'Tonight’s stories' }),
        h('p', { class: 'meta', text: formatDate(latest, true) }),
        h('ul', { class: 'story-list' }, ...todays.map(function (s) { return storyItem(s, true); }))
      );
    }).catch(function () { showError(); });
  }

  function viewArchive() {
    getIndex().then(function (stories) {
      var nodes = [h('h1', { text: 'Archive' }),
        h('p', { class: 'meta', text: stories.length + ' stories' })];
      var currentDate = null, list = null;
      stories.forEach(function (s) {
        if (s.date !== currentDate) {
          currentDate = s.date;
          nodes.push(h('h2', { text: formatDate(s.date) }));
          list = h('ul', { class: 'story-list' });
          nodes.push(list);
        }
        list.appendChild(storyItem(s, false));
      });
      render.apply(null, nodes);
    }).catch(function () { showError(); });
  }

  function viewFavorites() {
    getIndex().then(function (stories) {
      var byId = {};
      stories.forEach(function (s) { byId[s.id] = s; });
      var favs = getFavorites().filter(function (id) { return byId[id]; });
      var body = favs.length
        ? h('ul', { class: 'story-list' }, ...favs.map(function (id) { return storyItem(byId[id], false); }))
        : h('p', { class: 'quiet', text: 'No favorites yet. Tap “Add to favorites” at the end of a story to keep it here.' });

      var box = h('textarea', { 'aria-label': 'Favorites backup code', spellcheck: 'false' });
      var note = h('p', { 'aria-live': 'polite' });
      var tools = h('section', { class: 'tools' },
        h('p', { text: 'Favorites are saved on this phone only. Copy the backup code to keep them safe, or paste a code to restore.' }),
        h('button', { type: 'button', text: 'Copy backup code', onclick: function () {
          box.value = JSON.stringify(getFavorites());
          box.select();
          var done = function () { note.textContent = 'Copied.'; };
          if (navigator.clipboard) navigator.clipboard.writeText(box.value).then(done, function () { note.textContent = 'Select the text above and copy it.'; });
          else note.textContent = 'Select the text above and copy it.';
        } }),
        h('button', { type: 'button', text: 'Restore from code', onclick: function () {
          try {
            var ids = JSON.parse(box.value);
            if (!Array.isArray(ids)) throw new Error();
            var merged = getFavorites();
            ids.forEach(function (id) { if (typeof id === 'string' && merged.indexOf(id) === -1) merged.push(id); });
            save(FAV_KEY, merged);
            viewFavorites();
          } catch (e) { note.textContent = 'That code didn’t look right. Paste the whole thing, including the [ ].'; }
        } }),
        box, note);

      render(h('h1', { text: 'Favorites' }), body, tools);
    }).catch(function () { showError(); });
  }

  function viewStory(id) {
    var date = id.slice(0, 10);
    Promise.all([getIndex(), getDay(date)]).then(function (res) {
      var stories = res[0], day = res[1];
      var story = (day.stories || []).filter(function (s) { return s.id === id; })[0];
      if (!story) return showError('That story could not be found.');

      var star = h('button', { type: 'button', class: 'star' });
      function paintStar() {
        star.textContent = isFavorite(id) ? '★ Favorite' : '☆ Add to favorites';
        star.setAttribute('aria-pressed', String(isFavorite(id)));
      }
      star.addEventListener('click', function () { toggleFavorite(id); paintStar(); });
      paintStar();

      // Next story: the next one listed in the index (same night first, then older).
      var pos = stories.map(function (s) { return s.id; }).indexOf(id);
      var next = pos !== -1 ? stories[pos + 1] : null;

      render(
        h('a', { class: 'back', href: '#/', text: '← Tonight' }),
        h('h1', { text: story.title }),
        h('p', { class: 'meta', text: metaLine(story) + ' · ' + formatDate(date) }),
        h('div', { class: 'story-text' }, ...story.paragraphs.map(function (p) { return h('p', { text: p }); })),
        h('p', { class: 'the-end', text: 'The End' }),
        h('div', { class: 'story-actions' },
          star,
          next ? h('a', { href: '#/story/' + next.id, text: 'Next: ' + next.title }) : null)
      );
      keepAwake();
    }).catch(function () { showError(); });
  }

  // ---------- screen wake lock while reading ----------
  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  function releaseAwake() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && location.hash.indexOf('#/story/') === 0) keepAwake();
  });

  // ---------- router ----------
  function route() {
    var hash = location.hash || '#/';
    var navKey = 'tonight';
    releaseAwake();
    if (hash.indexOf('#/story/') === 0) { navKey = ''; viewStory(decodeURIComponent(hash.slice(8))); }
    else if (hash === '#/archive') { navKey = 'archive'; viewArchive(); }
    else if (hash === '#/favorites') { navKey = 'favorites'; viewFavorites(); }
    else viewTonight();

    document.querySelectorAll('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  // ---------- reading controls ----------
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme-toggle');

  function paintThemeButton() {
    themeBtn.textContent = root.getAttribute('data-theme') === 'light' ? 'Dark mode' : 'Light mode';
  }
  themeBtn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    document.getElementById('theme-color').setAttribute('content', next === 'light' ? '#f5efe3' : '#141210');
    saveRaw('bs.theme', next);
    paintThemeButton();
  });
  paintThemeButton();

  function currentSize() {
    var v = parseInt(getComputedStyle(root).getPropertyValue('--text-size'), 10);
    return isNaN(v) ? DEFAULT_SIZE : v;
  }
  function setSize(px) {
    px = Math.max(MIN_SIZE, Math.min(MAX_SIZE, px));
    root.style.setProperty('--text-size', px + 'px');
    saveRaw('bs.size', String(px));
  }
  document.getElementById('size-down').addEventListener('click', function () { setSize(currentSize() - 2); });
  document.getElementById('size-up').addEventListener('click', function () { setSize(currentSize() + 2); });

  window.addEventListener('hashchange', route);
  route();
})();

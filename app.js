// Bedtime Stories: a tiny hash-routed reader. No frameworks, no build step.
// Ratings and favorites live in this browser's localStorage.
(function () {
  'use strict';

  var view = document.getElementById('view');
  var FAV_KEY = 'bs.favorites';
  var RATE_KEY = 'bs.ratings';
  var MIN_SIZE = 16, MAX_SIZE = 32, DEFAULT_SIZE = 21;
  var AGE_ORDER = ['1–2', '3–4', '5–6'];
  var RATING_WORDS = ['', 'Not for us', 'It was okay', 'Liked it', 'Loved it', 'Ask for it again!'];

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
  }
  function getRatings() {
    var r = load(RATE_KEY, {});
    return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
  }
  function setRating(id, n) {
    var r = getRatings();
    if (r[id] === n) delete r[id]; else r[id] = n;
    save(RATE_KEY, r);
  }

  // ---------- data ----------
  var dataPromise = null;
  function getData() {
    if (!dataPromise) {
      dataPromise = Promise.all([
        fetch('stories/library.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }),
        fetch('stories/schedule.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      ]).then(function (res) {
        var stories = res[0].stories || [];
        var byId = {};
        stories.forEach(function (s) { byId[s.id] = s; });
        var nights = (res[1].nights || []).map(function (n) {
          return { date: n.date, stories: n.ids.map(function (id) { return byId[id]; }).filter(Boolean) };
        });
        return { stories: stories, byId: byId, nights: nights };
      }).catch(function (e) { dataPromise = null; throw e; });
    }
    return dataPromise;
  }

  // ---------- helpers ----------
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
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function render() {
    view.textContent = '';
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (Array.isArray(a)) a.forEach(function (x) { if (x) view.appendChild(x); });
      else if (a) view.appendChild(a);
    }
  }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function formatDate(iso, long) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString(undefined, long
      ? { weekday: 'long', month: 'long', day: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function avg(list) { return list.reduce(function (a, b) { return a + b; }, 0) / list.length; }
  function byAge(a, b) { return AGE_ORDER.indexOf(a.age) - AGE_ORDER.indexOf(b.age); }

  function metaLine(s) {
    return 'Ages ' + s.age + ' · ' + s.minutes + ' min · ' + s.author;
  }
  function storyItem(s, opts) {
    opts = opts || {};
    var r = getRatings()[s.id];
    var marks = (isFavorite(s.id) ? ' ♥' : '');
    return h('li', null,
      h('a', { href: '#/story/' + s.id, text: s.title + marks }),
      h('p', { class: 'meta', text: (opts.noAuthor ? 'Ages ' + s.age + ' · ' + s.minutes + ' min' : metaLine(s)) + (r ? ' · ' + stars(r) : '') }),
      opts.summary && s.summary ? h('p', { class: 'summary', text: s.summary }) : null,
      opts.reason ? h('p', { class: 'reason', text: opts.reason }) : null);
  }
  function storyList(list, opts) {
    return h('ul', { class: 'story-list' }, list.map(function (s) { return storyItem(s, opts); }));
  }
  function showError(msg) {
    render(h('p', { class: 'quiet', text: msg || 'Could not load stories. Check your connection and try again.' }));
  }

  // ---------- taste model and suggestions ----------
  // Each rating becomes a score from -2 (1 star) to +2 (5 stars). A favorite with
  // no rating counts as +2. Authors, genres, and themes collect those scores.
  function preferences(data) {
    var ratings = getRatings(), favs = getFavorites();
    var signals = {};
    Object.keys(ratings).forEach(function (id) { if (data.byId[id]) signals[id] = ratings[id] - 3; });
    favs.forEach(function (id) { if (data.byId[id] && !(id in signals)) signals[id] = 2; });

    var groups = { author: {}, genre: {}, tag: {} };
    Object.keys(signals).forEach(function (id) {
      var s = data.byId[id], v = signals[id];
      (groups.author[s.author] = groups.author[s.author] || []).push(v);
      (groups.genre[s.genre] = groups.genre[s.genre] || []).push(v);
      s.tags.forEach(function (t) { (groups.tag[t] = groups.tag[t] || []).push(v); });
    });
    return { signals: signals, groups: groups, count: Object.keys(signals).length };
  }

  function suggestions(data, limit, exclude) {
    var p = preferences(data);
    if (!p.count) return [];
    var ratings = getRatings();
    var out = [];
    data.stories.forEach(function (s) {
      if (s.id in ratings || (exclude && exclude.indexOf(s.id) !== -1)) return;
      var parts = [];
      var a = p.groups.author[s.author], g = p.groups.genre[s.genre];
      if (a) parts.push({ w: 2, v: avg(a), why: 'they liked other stories by ' + s.author });
      if (g) parts.push({ w: 1, v: avg(g), why: 'they liked other ' + s.genre.toLowerCase() });
      s.tags.forEach(function (t) {
        var tg = p.groups.tag[t];
        if (tg) parts.push({ w: 0.5, v: avg(tg), why: 'they liked stories about ' + t });
      });
      if (!parts.length) return;
      var score = parts.reduce(function (acc, x) { return acc + x.w * x.v; }, 0) / parts.reduce(function (acc, x) { return acc + x.w; }, 0);
      if (score <= 0) return;
      var best = parts.slice().sort(function (x, y) { return y.w * y.v - x.w * x.v; })[0];
      out.push({ story: s, score: score, reason: 'Because ' + best.why + '.' });
    });
    out.sort(function (x, y) { return y.score - x.score || x.story.title.localeCompare(y.story.title); });
    return out.slice(0, limit);
  }

  // ---------- views ----------
  function viewTonight() {
    getData().then(function (data) {
      if (!data.nights.length) return render(h('h1', { text: 'No stories yet' }),
        h('p', { class: 'quiet', text: 'Tonight’s stories are picked every morning.' }));
      var night = data.nights[0];
      var tonight = night.stories.slice().sort(byAge);
      var sugg = suggestions(data, 3, tonight.map(function (s) { return s.id; }));
      render(
        h('h1', { text: 'Tonight’s stories' }),
        h('p', { class: 'meta', text: formatDate(night.date, true) }),
        storyList(tonight, { summary: true }),
        h('h2', { text: 'Suggested for you' }),
        sugg.length
          ? h('ul', { class: 'story-list' }, sugg.map(function (x) { return storyItem(x.story, { reason: x.reason }); }))
          : h('p', { class: 'quiet small', text: 'Rate a few stories at the end of each one, and suggestions based on what your kids like will show up here.' })
      );
    }).catch(function () { showError(); });
  }

  var GROUPINGS = {
    author: { label: 'Author', key: function (s) { return s.author; } },
    genre: { label: 'Genre', key: function (s) { return s.genre; } },
    age: { label: 'Age', key: function (s) { return 'Ages ' + s.age; } },
    rating: { label: 'Rating', key: function (s) { var r = getRatings()[s.id]; return r ? stars(r) + '  ' + RATING_WORDS[r] : 'Not rated yet'; } },
    title: { label: 'A–Z', key: function (s) { return s.title.replace(/^(The|A) /, '').charAt(0).toUpperCase(); } }
  };

  function viewLibrary(groupBy) {
    if (!GROUPINGS[groupBy]) groupBy = 'author';
    getData().then(function (data) {
      var g = GROUPINGS[groupBy];
      var groups = {};
      data.stories.forEach(function (s) { (groups[g.key(s)] = groups[g.key(s)] || []).push(s); });
      var names = Object.keys(groups);
      if (groupBy === 'rating') names.sort(function (a, b) { return b.localeCompare(a); });
      else if (groupBy === 'age') names.sort();
      else names.sort(function (a, b) { return a.localeCompare(b); });

      var sortbar = h('p', { class: 'sortbar' }, 'Group by: ',
        Object.keys(GROUPINGS).map(function (k, i) {
          var el = k === groupBy
            ? h('strong', { text: GROUPINGS[k].label })
            : h('a', { href: '#/library/' + k, text: GROUPINGS[k].label });
          return i ? h('span', null, ' · ', el) : el;
        }));

      var nodes = [h('h1', { text: 'Library' }),
        h('p', { class: 'meta' }, data.stories.length + ' stories · ', h('a', { href: '#/nights', text: 'Past nights' })),
        sortbar];
      names.forEach(function (name) {
        var list = groups[name].slice().sort(function (a, b) { return byAge(a, b) || a.title.localeCompare(b.title); });
        var heading = groupBy === 'author' ? h('a', { href: '#/author/' + slug(name), text: name })
          : groupBy === 'genre' ? h('a', { href: '#/genre/' + slug(name), text: name }) : name;
        nodes.push(h('h2', null, heading));
        nodes.push(storyList(list, { noAuthor: groupBy === 'author' }));
      });
      render(nodes);
    }).catch(function () { showError(); });
  }

  function viewCollection(kind, key) {
    getData().then(function (data) {
      var field = kind === 'tag' ? null : kind;
      var list = data.stories.filter(function (s) {
        return field ? slug(s[field]) === key : s.tags.some(function (t) { return slug(t) === key; });
      });
      if (!list.length) return showError('Nothing found here.');
      var name = field ? list[0][field] : list[0].tags.filter(function (t) { return slug(t) === key; })[0];
      var ratings = getRatings();
      var rated = list.filter(function (s) { return ratings[s.id]; }).map(function (s) { return ratings[s.id]; });
      var intro = kind === 'author' ? 'Stories by' : kind === 'genre' ? 'Genre' : 'Stories about';
      list.sort(function (a, b) { return byAge(a, b) || a.title.localeCompare(b.title); });
      render(
        h('a', { class: 'back', href: '#/library/' + (kind === 'tag' ? 'author' : kind), text: '← Library' }),
        h('p', { class: 'meta', text: intro }),
        h('h1', { text: name }),
        h('p', { class: 'meta', text: list.length + ' stories' + (rated.length ? ' · average ' + avg(rated).toFixed(1) + ' ★ from ' + rated.length + ' rated' : '') }),
        storyList(list, { summary: true, noAuthor: kind === 'author' })
      );
    }).catch(function () { showError(); });
  }

  function viewNights() {
    getData().then(function (data) {
      var nodes = [h('a', { class: 'back', href: '#/library', text: '← Library' }), h('h1', { text: 'Past nights' })];
      data.nights.forEach(function (n) {
        nodes.push(h('h2', { text: formatDate(n.date) }));
        nodes.push(storyList(n.stories.slice().sort(byAge)));
      });
      render(nodes);
    }).catch(function () { showError(); });
  }

  function viewFavorites() {
    getData().then(function (data) {
      var favs = getFavorites().filter(function (id) { return data.byId[id]; }).map(function (id) { return data.byId[id]; });
      var body = favs.length ? storyList(favs)
        : h('p', { class: 'quiet', text: 'No favorites yet. Tap “♡ Favorite” at the end of a story to keep it here.' });

      var box = h('textarea', { 'aria-label': 'Backup code', spellcheck: 'false' });
      var note = h('p', { 'aria-live': 'polite' });
      var tools = h('section', { class: 'tools' },
        h('h2', { text: 'Backup' }),
        h('p', { text: 'Favorites and ratings are saved on this phone only. Copy the backup code to keep them safe, or paste a code to restore them.' }),
        h('button', { type: 'button', text: 'Copy backup code', onclick: function () {
          box.value = JSON.stringify({ favorites: getFavorites(), ratings: getRatings() });
          box.select();
          var manual = function () { note.textContent = 'Select the text above and copy it.'; };
          if (navigator.clipboard) navigator.clipboard.writeText(box.value).then(function () { note.textContent = 'Copied.'; }, manual);
          else manual();
        } }),
        h('button', { type: 'button', text: 'Restore from code', onclick: function () {
          try {
            var data = JSON.parse(box.value);
            var ids = Array.isArray(data) ? data : data.favorites || [];
            var merged = getFavorites();
            ids.forEach(function (id) { if (typeof id === 'string' && merged.indexOf(id) === -1) merged.push(id); });
            save(FAV_KEY, merged);
            if (data.ratings && typeof data.ratings === 'object') {
              var r = getRatings();
              Object.keys(data.ratings).forEach(function (id) {
                var n = Number(data.ratings[id]);
                if (n >= 1 && n <= 5) r[id] = n;
              });
              save(RATE_KEY, r);
            }
            viewFavorites();
          } catch (e) { note.textContent = 'That code didn’t look right. Paste the whole thing, including the brackets.'; }
        } }),
        box, note);

      render(h('h1', { text: 'Favorites' }), body, tools);
    }).catch(function () { showError(); });
  }

  // A plain bar chart: one row per author, genre, or theme, sized by average rating.
  function barChart(groups, ratingsOnly, data, kind) {
    var rows = Object.keys(groups).map(function (name) {
      var vals = groups[name];
      return { name: name, avg: avg(vals) + 3, n: vals.length };
    });
    rows.sort(function (a, b) { return b.avg - a.avg || b.n - a.n; });
    return h('div', { class: 'chart' }, rows.map(function (r) {
      var pct = Math.max(4, Math.round((r.avg - 1) / 4 * 100));
      var label = kind ? h('a', { href: '#/' + kind + '/' + slug(r.name), text: r.name }) : r.name;
      return h('div', { class: 'chart-row' },
        h('div', { class: 'chart-label' }, label, h('span', { class: 'quiet', text: '  ' + r.avg.toFixed(1) + ' ★ · ' + r.n })),
        h('div', { class: 'chart-track', 'aria-hidden': 'true' }, h('div', { class: 'chart-bar', style: 'width:' + pct + '%' })));
    }));
  }

  function viewTastes() {
    getData().then(function (data) {
      var p = preferences(data);
      var ratings = getRatings();
      var ratedCount = Object.keys(ratings).filter(function (id) { return data.byId[id]; }).length;
      var heard = {};
      data.nights.forEach(function (n) { n.stories.forEach(function (s) { heard[s.id] = 1; }); });

      if (!p.count) {
        return render(h('h1', { text: 'What they like' }),
          h('p', { class: 'quiet', text: 'Nothing here yet. At the end of each story, tap a star rating for how much the kids liked it. After a few, this page shows which authors, kinds of stories, and themes they enjoy most, and the home page starts suggesting more like them.' }));
      }

      var sugg = suggestions(data, 5);
      render(
        h('h1', { text: 'What they like' }),
        h('p', { class: 'meta', text: ratedCount + ' rated · ' + getFavorites().length + ' favorites · ' + Object.keys(heard).length + ' of ' + data.stories.length + ' stories offered so far' }),
        h('p', { class: 'quiet small', text: 'Bars show the average star rating. The number after it is how many stories it’s based on. Favorites without a rating count as 5 stars.' }),
        h('h2', { text: 'By author' }), barChart(p.groups.author, true, data, 'author'),
        h('h2', { text: 'By kind of story' }), barChart(p.groups.genre, true, data, 'genre'),
        h('h2', { text: 'By theme' }), barChart(p.groups.tag, true, data, 'tag'),
        h('h2', { text: 'Try next' }),
        sugg.length
          ? h('ul', { class: 'story-list' }, sugg.map(function (x) { return storyItem(x.story, { reason: x.reason }); }))
          : h('p', { class: 'quiet small', text: 'No suggestions yet. Rate a few more stories.' })
      );
    }).catch(function () { showError(); });
  }

  function viewStory(id) {
    getData().then(function (data) {
      var story = data.byId[id];
      if (!story) return showError('That story could not be found.');

      var fav = h('button', { type: 'button', class: 'star' });
      function paintFav() {
        fav.textContent = isFavorite(id) ? '♥ Favorite' : '♡ Favorite';
        fav.setAttribute('aria-pressed', String(isFavorite(id)));
      }
      fav.addEventListener('click', function () { toggleFavorite(id); paintFav(); });
      paintFav();

      var ratingWord = h('p', { class: 'rating-word', 'aria-live': 'polite' });
      var starButtons = [1, 2, 3, 4, 5].map(function (n) {
        return h('button', { type: 'button', class: 'rate', 'aria-label': n + ' star' + (n > 1 ? 's' : '') + ': ' + RATING_WORDS[n] });
      });
      function paintStars() {
        var r = getRatings()[id] || 0;
        starButtons.forEach(function (b, i) {
          b.textContent = i < r ? '★' : '☆';
          b.setAttribute('aria-pressed', String(i + 1 === r));
        });
        ratingWord.textContent = r ? RATING_WORDS[r] : 'Tap a star';
      }
      starButtons.forEach(function (b, i) { b.addEventListener('click', function () { setRating(id, i + 1); paintStars(); }); });
      paintStars();

      // Next: the next of tonight's stories, otherwise the top suggestion.
      var tonight = data.nights.length ? data.nights[0].stories.slice().sort(byAge) : [];
      var pos = tonight.map(function (s) { return s.id; }).indexOf(id);
      var next = pos !== -1 && pos < tonight.length - 1 ? tonight[pos + 1] : null;
      if (!next) {
        var sg = suggestions(data, 1, [id]);
        next = sg.length ? sg[0].story : null;
      }

      render(
        h('a', { class: 'back', href: '#/', text: '← Tonight' }),
        h('h1', { text: story.title }),
        h('p', { class: 'meta' },
          'Ages ' + story.age + ' · ' + story.minutes + ' min · ',
          h('a', { href: '#/author/' + slug(story.author), text: story.author }), ' · ',
          h('a', { href: '#/genre/' + slug(story.genre), text: story.genre })),
        h('div', { class: 'story-text' }, story.paragraphs.map(function (p) {
          return h('p', { class: p.indexOf('\n') !== -1 ? 'verse' : null, text: p });
        })),
        story.moral ? h('p', { class: 'moral', text: story.moral }) : null,
        h('p', { class: 'the-end', text: 'The End' }),
        h('section', { class: 'rating', 'aria-label': 'Rate this story' },
          h('p', { class: 'rating-q', text: 'How did they like it?' }),
          h('div', { class: 'rate-row' }, starButtons),
          ratingWord),
        h('div', { class: 'story-actions' },
          fav,
          next ? h('a', { href: '#/story/' + next.id, text: 'Next: ' + next.title }) : null),
        h('p', { class: 'source' }, 'Themes: ',
          story.tags.map(function (t, i) { return h('span', null, i ? ', ' : '', h('a', { href: '#/tag/' + slug(t), text: t })); }),
          h('br'), 'From ' + story.source + '.')
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
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var navKey = 'tonight';
    releaseAwake();
    switch (parts[0]) {
      case 'story': navKey = ''; viewStory(parts[1]); break;
      case 'library': navKey = 'library'; viewLibrary(parts[1]); break;
      case 'author': case 'genre': case 'tag': navKey = 'library'; viewCollection(parts[0], parts[1]); break;
      case 'nights': case 'archive': navKey = 'library'; viewNights(); break;
      case 'favorites': navKey = 'favorites'; viewFavorites(); break;
      case 'tastes': navKey = 'tastes'; viewTastes(); break;
      default: viewTonight();
    }
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

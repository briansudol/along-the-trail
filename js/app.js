(function () {
  "use strict";

  var STORAGE_KEY = "mushroom-atlas-community-v1";
  var NEWSLETTER_KEY = "mushroom-atlas-newsletter-v1";
  var catalog = null;
  var community = [];
  var activeFilter = "all";
  var searchQuery = "";
  var viewMode = "mushrooms"; // mushrooms | wildlife
  var sortMode = "name";
  var PAGE_SIZE = 12;
  var visibleCount = PAGE_SIZE;
  var FAV_KEY = "mushroom-atlas-favorites-v1";
  var favorites = [];
  var loadingMore = false;

  var els = {
    grid: document.getElementById("gallery-grid"),
    empty: document.getElementById("empty-state"),
    count: document.getElementById("result-count"),
    search: document.getElementById("search-input"),
    clear: document.getElementById("search-clear"),
    chips: document.querySelectorAll(".chip"),
    modal: document.getElementById("detail-modal"),
    detail: document.getElementById("detail-content"),
    form: document.getElementById("upload-form"),
    photo: document.getElementById("up-photo"),
    preview: document.getElementById("upload-preview"),
    status: document.getElementById("upload-status"),
    aboutDisclaimer: document.getElementById("about-disclaimer"),
    aboutAuthors: document.getElementById("about-authors"),
    header: document.querySelector(".site-header"),
    toggle: document.querySelector(".nav-toggle"),
    mobileNav: document.getElementById("mobile-nav"),
    newsletterForm: document.getElementById("newsletter-form"),
    newsletterStatus: document.getElementById("newsletter-status"),
    galleryTitle: document.getElementById("gallery-heading"),
    sort: document.getElementById("gallery-sort"),
    emptyTitle: document.getElementById("empty-title"),
    emptyCopy: document.getElementById("empty-copy"),
    emptyReset: document.getElementById("empty-reset"),
    pager: document.getElementById("gallery-pager"),
    range: document.getElementById("gallery-range"),
    pageButtons: document.getElementById("page-buttons"),
    loadMore: document.getElementById("load-more"),
    sentinel: document.getElementById("gallery-sentinel"),
  };

  var THEME_KEY = "mushroom-atlas-theme";
  var lastFocus = null;
  var modalCloseTimer = null;
  var detailCarousel = null;
  var galleryHasEntered = false;

  function reduceMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function markImagesLoaded(root) {
    (root || document).querySelectorAll("img").forEach(function (img) {
      function done() {
        img.classList.add("is-loaded");
      }
      if (img.complete && img.naturalWidth) done();
      else {
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      }
    });
  }

  function pauseVideos(root) {
    (root || els.detail || document).querySelectorAll("video").forEach(function (v) {
      try {
        v.pause();
      } catch (e) {}
    });
  }

  function setupTheme() {
    var btn = document.getElementById("theme-toggle");
    function current() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }
    function sync() {
      var t = current();
      if (btn) {
        btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
        btn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
      }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", t === "dark" ? "#121a16" : "#f6f1e6");
    }
    function apply(theme, persist) {
      document.documentElement.setAttribute("data-theme", theme);
      if (persist) {
        try {
          localStorage.setItem(THEME_KEY, theme);
        } catch (e) {}
      }
      sync();
    }
    sync();
    if (btn) {
      btn.addEventListener("click", function () {
        apply(current() === "dark" ? "light" : "dark", true);
      });
    }
    try {
      if (!localStorage.getItem(THEME_KEY) && window.matchMedia) {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
          if (localStorage.getItem(THEME_KEY)) return;
          apply(e.matches ? "dark" : "light", false);
        });
      }
    } catch (e) {}
  }
  setupTheme();

  function loadFavorites() {
    try {
      var list = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      favorites = Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (e) {
      favorites = [];
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
    } catch (e) {}
  }

  function isFav(id) {
    return !!id && favorites.indexOf(id) !== -1;
  }

  function toggleFavorite(id) {
    if (!id) return;
    if (isFav(id)) {
      favorites = favorites.filter(function (x) {
        return x !== id;
      });
    } else {
      favorites.push(id);
    }
    saveFavorites();
    document.querySelectorAll('.fav-btn[data-fav-id="' + id + '"]').forEach(function (btn) {
      var on = isFav(id);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Remove from favorites" : "Save to favorites");
      var body = btn.parentNode && btn.parentNode.querySelector(".card-body");
      if (body) {
        var flag = body.querySelector(".saved-flag");
        if (on && !flag) {
          body.insertAdjacentHTML(
            "beforeend",
            '<span class="card-badge community saved-flag">Saved</span>'
          );
        } else if (!on && flag) {
          flag.parentNode.removeChild(flag);
        }
      }
    });
    updateChipCounts();
    if (activeFilter === "favorites") renderGallery();
    if (trailMap && mapData) renderMapRegion(activeMapRegion);
  }

  function highlight(text) {
    var raw = String(text || "");
    var q = searchQuery.trim();
    if (!q) return escapeHtml(raw);
    var lower = raw.toLowerCase();
    var needle = q.toLowerCase();
    var out = "";
    var i = 0;
    var idx;
    while ((idx = lower.indexOf(needle, i)) !== -1) {
      out += escapeHtml(raw.slice(i, idx));
      out += '<mark class="search-hit">' + escapeHtml(raw.slice(idx, idx + q.length)) + "</mark>";
      i = idx + q.length;
    }
    out += escapeHtml(raw.slice(i));
    return out;
  }

  function seasonKey(item) {
    var s = String(item.season || "").toLowerCase();
    var rank = "9";
    if (/spring/.test(s)) rank = "1";
    else if (/summer/.test(s)) rank = "2";
    else if (/fall|autumn/.test(s)) rank = "3";
    else if (/winter/.test(s)) rank = "4";
    return rank + ":" + s;
  }

  function sortItems(items) {
    var list = items.slice();
    list.sort(function (a, b) {
      var cmp = 0;
      if (sortMode === "season") {
        cmp = seasonKey(a).localeCompare(seasonKey(b));
      } else if (sortMode === "location") {
        cmp = primaryLocation(a).localeCompare(primaryLocation(b), undefined, { sensitivity: "base" });
      }
      if (cmp) return cmp;
      return String(a.common_name || "").localeCompare(String(b.common_name || ""), undefined, {
        sensitivity: "base",
      });
    });
    return list;
  }

  function emptyMessage() {
    var q = searchQuery.trim();
    if (activeFilter === "favorites") {
      return {
        title: "No favorites yet",
        copy: q
          ? "None of your saved finds match that search."
          : "Tap the heart on a card to save it on this device. Favorites stay in your browser.",
      };
    }
    if (activeFilter === "community") {
      return {
        title: "No community finds here",
        copy: q
          ? "Nothing in community uploads matches that search."
          : "Be the first — share a trail photo in the form below.",
      };
    }
    if (activeFilter === "pending") {
      return {
        title: "Nothing pending ID",
        copy: "Unidentified community finds and unlabeled photos will show up here.",
      };
    }
    if (q) {
      return {
        title: "No matches for “" + q + "”",
        copy: "Try a common name, tree, park, or clear search to browse the atlas.",
      };
    }
    return {
      title: "No finds in this category",
      copy: "Choose another chip, switch sort, or browse All.",
    };
  }

  function loadCommunity() {
    try {
      community = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
      community = [];
    }
  }

  function saveCommunity() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(community));
    } catch (e) {
      if (els.status) {
        els.status.textContent = "Could not save in this browser (storage full or blocked).";
        els.status.classList.add("error");
      }
    }
  }

  function upsertCommunity(entry) {
    if (!entry || !entry.id) return;
    var found = false;
    community = community.map(function (item) {
      if (item.id === entry.id) {
        found = true;
        return entry;
      }
      return item;
    });
    if (!found) community.unshift(entry);
    saveCommunity();
  }

  function hydrateCommunity() {
    if (!window.TrailPersist) return;
    TrailPersist.init()
      .then(function () {
        return TrailPersist.loadCommunity();
      })
      .then(function (list) {
        community = list || community;
        saveCommunity();
        renderGallery();
        if (trailMap && mapData) renderMapRegion(activeMapRegion);
      })
      .catch(function (err) {
        console.warn("Community persist hydrate skipped", err);
      });
  }

  function mushroomGroups() {
    return (catalog && catalog.groups) || [];
  }

  function wildlifeItems() {
    return (catalog && catalog.wildlife) || [];
  }

  /** Flatten for maps / search helpers */
  function allGalleryItems() {
    if (viewMode === "wildlife") {
      return wildlifeItems().map(function (w) {
        return Object.assign({}, w, { source: "wildlife", is_group: false });
      });
    }
    var items = mushroomGroups().map(function (g) {
      return Object.assign({}, g, { source: "curated", is_group: true });
    });
    community.forEach(function (c) {
      if (c && c.status === "rejected") return;
      items.push(
        Object.assign({}, c, {
          source: "community",
          is_group: false,
          photos: c.photos || [],
        })
      );
    });
    return items;
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    var parts = [
      item.common_name,
      item.scientific_name,
      item.category,
      item.edibility,
      item.summary,
      item.uses,
      item.habitat,
      item.tree_associates,
      item.field_marks,
      item.season,
      item.region_notes,
      item.location,
      item.notes,
    ];
    (item.subcategories || []).forEach(function (s) {
      parts.push(s.name, s.note);
    });
    (item.photos || []).forEach(function (p) {
      parts.push(p.caption, p.location, p.taken_at, formatTakenAt(photoTakenAt(p)));
    });
    return parts.filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
  }

  function matchesFilter(item, filter) {
    if (filter === "all") return true;
    if (filter === "favorites") return isFav(item.id);
    if (filter === "community") return item.source === "community";
    if (filter === "pending") {
      return (
        item.pending_id === true ||
        item.confidence === "pending" ||
        /unidentified|pending identification/i.test(item.scientific_name || "") ||
        /unidentified find|other trail finds/i.test(item.common_name || "")
      );
    }
    return item.category_slug === filter;
  }

  function filteredItems() {
    var q = searchQuery.trim().toLowerCase();
    return allGalleryItems().filter(function (item) {
      return matchesFilter(item, activeFilter) && matchesSearch(item, q);
    });
  }

  function updateChipCounts() {
    document.querySelectorAll("#mushroom-filters [data-count-for]").forEach(function (el) {
      var filter = el.getAttribute("data-count-for");
      var q = searchQuery.trim().toLowerCase();
      var n = allGalleryItems().filter(function (item) {
        return matchesFilter(item, filter) && matchesSearch(item, q);
      }).length;
      el.textContent = String(n);
    });
  }

  function syncFilterChips() {
    document.querySelectorAll("#mushroom-filters .chip").forEach(function (c) {
      c.classList.toggle("is-active", c.getAttribute("data-filter") === activeFilter);
    });
    document.querySelectorAll("#map-filters .chip").forEach(function (c) {
      var f = c.getAttribute("data-filter");
      var on =
        f === "wildlife"
          ? viewMode === "wildlife"
          : viewMode !== "wildlife" && f === activeFilter;
      c.classList.toggle("is-active", on);
    });
  }

  function setFilter(filter, opts) {
    opts = opts || {};
    if (filter === "wildlife") {
      viewMode = "wildlife";
      activeFilter = "all";
    } else {
      if (viewMode === "wildlife" && filter !== "all" && filter !== "favorites") {
        viewMode = "mushrooms";
      }
      activeFilter = filter || "all";
    }
    visibleCount = PAGE_SIZE;
    updateViewChrome();
    syncFilterChips();
    renderGallery();
    if (!opts.skipMap && trailMap && mapData) renderMapRegion(activeMapRegion);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isVideoSrc(src) {
    return /\.(mp4|webm|mov|ogg)(\?|$)/i.test(src || "");
  }

  function isVideoMedia(media) {
    if (!media) return false;
    if (media.type === "video") return true;
    return isVideoSrc(media.src || media);
  }

  function mediaPoster(media) {
    if (!media) return "";
    if (typeof media === "string") return isVideoSrc(media) ? "" : media;
    return media.poster || (isVideoMedia(media) ? "" : media.src) || "";
  }

  function primaryPhoto(item) {
    if (item.cover_image) return item.cover_image;
    if (item.photos && item.photos.length) {
      var first = item.photos[0];
      if (isVideoMedia(first)) return first.poster || first.src || "";
      return first.src;
    }
    return item.image || "";
  }

  function galleryCountText(item) {
    var photos = item.photos || [];
    var n = photos.length;
    var videos = photos.filter(isVideoMedia).length;
    var stills = n - videos;
    var trail = item.category_slug === "wildlife" ? "" : "trail ";
    var parts = [];
    if (stills === 1) parts.push("1 " + trail + "photo");
    else if (stills > 1) parts.push(stills + " " + trail + "photos");
    if (videos === 1) parts.push("1 video");
    else if (videos > 1) parts.push(videos + " videos");
    if (!parts.length) return "No photos in this gallery yet";
    return parts.join(" and ") + " in this gallery";
  }

  function cardMediaHtml(item) {
    var cover = item.cover_image || "";
    var photos = item.photos || [];
    var video = photos.find(function (p) {
      return isVideoMedia(p);
    });
    // Prefer still cover for card; fall back to video poster or first frame media
    var imgSrc = cover || (video && video.poster) || primaryPhoto(item);
    var badge = video
      ? '<span class="media-badge media-badge-video" aria-hidden="true">▶ Video</span>'
      : "";
    return (
      '<div class="card-image">' +
      badge +
      '<img src="' +
      escapeHtml(imgSrc) +
      '" alt="' +
      escapeHtml(item.common_name) +
      '" loading="lazy" />' +
      '<span class="card-open-hint" aria-hidden="true">Open gallery</span>' +
      "</div>" +
      '<div class="card-cover-meta">' +
      '<p class="card-count">' +
      escapeHtml(galleryCountText(item)) +
      "</p>" +
      '<p class="card-click-hint">Click to open</p>' +
      "</div>"
    );
  }

  function mainMediaHtml(media, alt) {
    if (!media || !media.src) return '<img class="detail-main-img" src="" alt="" />';
    if (isVideoMedia(media)) {
      var poster = media.poster ? ' poster="' + escapeHtml(media.poster) + '"' : "";
      return (
        '<video class="detail-main-video" controls playsinline preload="metadata"' +
        poster +
        ">" +
        '<source src="' +
        escapeHtml(media.src) +
        '" type="video/mp4" />' +
        "Your browser does not support the video tag." +
        "</video>"
      );
    }
    return (
      '<img class="detail-main-img" src="' +
      escapeHtml(media.src) +
      '" alt="' +
      escapeHtml(alt || "") +
      '" draggable="false" />'
    );
  }

  function thumbSrcFor(media) {
    if (!media) return "";
    if (isVideoMedia(media)) return media.poster || media.src || "";
    return media.src || "";
  }

  function primaryLocation(item) {
    if (item.location) return item.location;
    if (item.photos && item.photos[0]) return item.photos[0].location || "";
    return item.region_notes || "";
  }

  function edibilityBadge(edibility) {
    var danger = /poison|deadly|toxic|do not eat|treat as/i.test(edibility || "");
    var cls = "card-badge" + (danger ? " danger" : "");
    return '<span class="' + cls + '">' + escapeHtml(edibility || "See details") + "</span>";
  }

  function renderGallery() {
    var items = sortItems(filteredItems());
    var noun =
      viewMode === "wildlife"
        ? items.length === 1
          ? "wildlife entry"
          : "wildlife entries"
        : items.length === 1
          ? "group"
          : "groups";
    var extra = [];
    if (searchQuery) extra.push("matching “" + searchQuery.trim() + "”");
    if (activeFilter !== "all") extra.push("in " + activeFilter.replace("-", " "));
    els.count.textContent =
      items.length +
      " " +
      noun +
      (extra.length ? " " + extra.join(" ") : " in the atlas");

    if (els.galleryTitle) {
      els.galleryTitle.textContent =
        viewMode === "wildlife"
          ? "Wildlife of the trail"
          : activeFilter === "favorites"
            ? "Saved favorites"
            : "Mushroom groups";
    }

    updateChipCounts();
    syncFilterChips();

    if (els.pager) els.pager.hidden = true;
    if (!items.length) {
      els.grid.innerHTML = "";
      els.grid.setAttribute("aria-busy", "false");
      els.grid.classList.remove("is-entering");
      var msg = emptyMessage();
      if (els.emptyTitle) els.emptyTitle.textContent = msg.title;
      if (els.emptyCopy) els.emptyCopy.textContent = msg.copy;
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;
    els.grid.setAttribute("aria-busy", "false");
    var enter = !galleryHasEntered && !reduceMotion();
    galleryHasEntered = true;
    els.grid.classList.toggle("is-entering", enter);

    if (visibleCount > items.length) visibleCount = items.length;
    if (visibleCount < 1) visibleCount = Math.min(PAGE_SIZE, items.length);
    var shown = items.slice(0, visibleCount);

    els.grid.innerHTML = shown
      .map(function (item) {
        var loc = primaryLocation(item);
        var pending =
          item.pending_id === true ||
          item.confidence === "pending" ||
          /unidentified find|other trail finds/i.test(item.common_name || "");
        var badges = "";
        if (pending) badges += '<span class="card-badge pending">Pending ID</span>';
        else if (item.source === "community")
          badges += '<span class="card-badge community">Community</span>';
        if (isFav(item.id)) badges += '<span class="card-badge community saved-flag">Saved</span>';
        var sub =
          item.subcategories && item.subcategories.length
            ? '<p class="card-loc">' +
              highlight(
                item.subcategories
                  .map(function (s) {
                    return s.name;
                  })
                  .join(" · ")
              ) +
              "</p>"
            : "";
        var kind =
          viewMode === "wildlife" ? "wildlife" : item.is_group ? "group" : "community";
        var favOn = isFav(item.id);

        return (
          '<article class="card" data-id="' +
          escapeHtml(item.id) +
          '">' +
          '<button type="button" class="fav-btn' +
          (favOn ? " is-on" : "") +
          '" data-fav-id="' +
          escapeHtml(item.id) +
          '" aria-pressed="' +
          (favOn ? "true" : "false") +
          '" aria-label="' +
          (favOn ? "Remove from favorites" : "Save to favorites") +
          '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.2-9.5-8.1C.4 9.7 1.1 5.8 4.4 4.3 6.4 3.3 8.8 3.9 12 7c3.2-3.1 5.6-3.7 7.6-2.7 3.3 1.5 4 5.4 1.9 8.6C18.7 16.8 12 21 12 21z"/></svg></button>' +
          '<button type="button" class="card-main" data-id="' +
          escapeHtml(item.id) +
          '" data-kind="' +
          kind +
          '" aria-label="' +
          escapeHtml(item.common_name + ". " + galleryCountText(item) + ". Open details.") +
          '">' +
          cardMediaHtml(item) +
          '<div class="card-body">' +
          '<span class="card-category">' +
          highlight(item.category || "") +
          "</span>" +
          '<h3 class="card-title">' +
          highlight(item.common_name) +
          "</h3>" +
          '<p class="card-sci">' +
          highlight(item.scientific_name || "") +
          "</p>" +
          sub +
          (loc && !sub ? '<p class="card-loc">' + highlight(loc) + "</p>" : "") +
          (item.season ? '<p class="card-loc">' + highlight(item.season) + "</p>" : "") +
          (pending ? "" : edibilityBadge(item.edibility)) +
          badges +
          "</div></button></article>"
        );
      })
      .join("");

    els.grid.querySelectorAll(".card").forEach(function (card, i) {
      if (enter) card.style.animationDelay = Math.min(i * 40, 420) + "ms";
    });
    els.grid.querySelectorAll(".card-main").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDetail(btn.getAttribute("data-id"), btn.getAttribute("data-kind"));
      });
    });
    els.grid.querySelectorAll(".fav-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(btn.getAttribute("data-fav-id"));
      });
    });
    markImagesLoaded(els.grid);
    renderPager(items.length, shown.length);
  }

  function renderPager(total, shown) {
    if (!els.pager) return;
    if (total <= PAGE_SIZE) {
      els.pager.hidden = true;
      return;
    }
    els.pager.hidden = false;
    if (els.range) {
      els.range.textContent = "Showing " + shown + " of " + total;
    }
    if (els.loadMore) {
      els.loadMore.hidden = shown >= total;
    }
    if (els.pageButtons) {
      var pages = Math.ceil(total / PAGE_SIZE);
      var current = Math.max(1, Math.ceil(shown / PAGE_SIZE));
      var html = "";
      for (var p = 1; p <= pages; p++) {
        html +=
          '<button type="button" class="page-btn' +
          (p === current ? " is-active" : "") +
          '" data-page="' +
          p +
          '" aria-label="Page ' +
          p +
          '">' +
          p +
          "</button>";
      }
      els.pageButtons.innerHTML = html;
      els.pageButtons.querySelectorAll(".page-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var page = parseInt(btn.getAttribute("data-page"), 10) || 1;
          visibleCount = page * PAGE_SIZE;
          renderGallery();
          if (els.grid) els.grid.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
        });
      });
    }
  }

  function loadMoreGallery() {
    if (loadingMore) return;
    var total = filteredItems().length;
    if (visibleCount >= total) return;
    loadingMore = true;
    visibleCount += PAGE_SIZE;
    renderGallery();
    loadingMore = false;
  }

  function findItem(id, kind) {
    if (kind === "wildlife" || viewMode === "wildlife") {
      return wildlifeItems().find(function (w) {
        return w.id === id;
      });
    }
    var g = mushroomGroups().find(function (x) {
      return x.id === id;
    });
    if (g) return Object.assign({}, g, { is_group: true });
    return community.find(function (c) {
      return c.id === id;
    });
  }

  function block(title, text) {
    if (!text) return "";
    return (
      '<div class="detail-block"><h3>' +
      escapeHtml(title) +
      "</h3><p>" +
      escapeHtml(text) +
      "</p></div>"
    );
  }

  function photoTakenAt(photo) {
    if (!photo) return "";
    if (photo.taken_at) return photo.taken_at;
    if (photo.id_detail && photo.id_detail.taken_at) return photo.id_detail.taken_at;
    return "";
  }

  /** Format camera EXIF timestamps without timezone shifting. */
  function formatTakenAt(iso) {
    if (!iso) return "";
    var m = String(iso).match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
    );
    if (!m) return String(iso);
    var months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    var date = months[parseInt(m[2], 10) - 1] + " " + parseInt(m[3], 10) + ", " + m[1];
    if (m[4] != null) {
      var h = parseInt(m[4], 10);
      var min = m[5];
      var ampm = h >= 12 ? "p.m." : "a.m.";
      var h12 = h % 12 || 12;
      date += " · " + h12 + ":" + min + " " + ampm;
    }
    return date;
  }

  function renderIdPanel(item, photo) {
    var d = (photo && photo.id_detail) || {};
    var common = d.common_name || item.common_name;
    var scientific = d.scientific_name || item.scientific_name;
    var edibility = d.edibility || item.edibility || "";
    var danger = /poison|deadly|toxic|do not eat|treat as/i.test(edibility);
    var loc = (d.photo_location || (photo && photo.location) || "") ;
    var view = (d.view || (photo && photo.view) || "");
    var conf = d.confidence || item.confidence || "";
    var taken = formatTakenAt(photoTakenAt(photo));

    return (
      '<div id="detail-id-panel">' +
      '<div class="detail-header" style="padding-bottom:0.5rem">' +
      '<span class="card-category">' +
      escapeHtml(item.category || "") +
      (item.is_group || item.photos && item.photos.length > 1 ? " · group" : "") +
      "</span>" +
      '<p class="photo-specific-label">This photo</p>' +
      '<h2 id="detail-title">' +
      escapeHtml(common) +
      "</h2>" +
      '<p class="detail-sci">' +
      escapeHtml(scientific || "") +
      "</p>" +
      '<span class="detail-edibility' +
      (danger ? " is-danger" : "") +
      '">' +
      escapeHtml(edibility) +
      "</span>" +
      (view
        ? ' <span class="card-badge community">' + escapeHtml(view) + " view</span>"
        : "") +
      "</div>" +
      '<div class="detail-body" style="padding-top:0.5rem">' +
      block("Identification", d.summary || item.summary) +
      block("Uses", d.uses || item.uses) +
      block("Where it grows", d.habitat || item.habitat) +
      block("Tree & forest associates", d.tree_associates || item.tree_associates) +
      block("Field marks", d.field_marks || item.field_marks) +
      (taken ? block("Photographed", taken) : "") +
      block("Season", item.season) +
      block("Group overview", item.is_group ? item.summary : "") +
      "</div>" +
      '<div class="detail-meta">' +
      (conf ? "<p><strong>ID confidence:</strong> " + escapeHtml(conf) + "</p>" : "") +
      (loc ? "<p><strong>Photo location:</strong> " + escapeHtml(loc) + "</p>" : "") +
      (photo && photo.lat != null
        ? "<p><strong>GPS:</strong> " +
          Number(photo.lat).toFixed(5) +
          ", " +
          Number(photo.lon).toFixed(5) +
          "</p>"
        : "") +
      (item.is_group
        ? "<p><strong>Group:</strong> " +
          escapeHtml(item.common_name) +
          " — click other photos for their specific IDs</p>"
        : "") +
      "</div></div>"
    );
  }

  function bindCarousel(root, photos, startIdx, onChange) {
    var viewport = root.querySelector(".carousel-viewport");
    var track = root.querySelector(".carousel-track");
    var counter = root.querySelector(".carousel-counter-pos");
    var slides = root.querySelectorAll(".carousel-slide");
    if (!viewport || !track || !photos.length) return null;

    var index = startIdx || 0;
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var dx = 0;
    var startT = 0;
    var axis = null;
    var reduced = reduceMotion();

    function setTransform(pxOffset) {
      var base = -index * 100;
      if (pxOffset) {
        track.style.transform = "translateX(calc(" + base + "% + " + pxOffset + "px))";
      } else {
        track.style.transform = "translateX(" + base + "%)";
      }
    }

    function goTo(next, instant) {
      if (!photos.length) return;
      next = ((next % photos.length) + photos.length) % photos.length;
      pauseVideos(root);
      index = next;
      if (instant || reduced) {
        track.style.transition = "none";
        setTransform(0);
        if (!reduced) {
          requestAnimationFrame(function () {
            track.style.transition = "";
          });
        }
      } else {
        track.style.transition = "";
        setTransform(0);
      }
      slides.forEach(function (slide, i) {
        var on = i === index;
        slide.classList.toggle("is-active", on);
        slide.setAttribute("aria-hidden", on ? "false" : "true");
      });
      root.querySelectorAll(".detail-photo-nav button").forEach(function (btn) {
        btn.classList.toggle("is-active", parseInt(btn.getAttribute("data-photo-idx"), 10) === index);
      });
      if (counter) counter.textContent = String(index + 1);
      if (onChange) onChange(index, photos[index]);
    }

    goTo(index, true);

    root.querySelectorAll(".carousel-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goTo(index + (btn.classList.contains("carousel-next") ? 1 : -1));
      });
    });

    root.querySelectorAll(".detail-photo-nav button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goTo(parseInt(btn.getAttribute("data-photo-idx"), 10));
      });
    });

    viewport.addEventListener("pointerdown", function (e) {
      if (photos.length < 2) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest("video, button, a")) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.clientX;
      startY = e.clientY;
      startT = Date.now();
      track.style.transition = "none";
      viewport.classList.add("is-dragging");
      try {
        viewport.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    viewport.addEventListener(
      "pointermove",
      function (e) {
        if (!dragging) return;
        var mx = e.clientX - startX;
        var my = e.clientY - startY;
        if (!axis) {
          if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
          axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
          if (axis === "y") {
            dragging = false;
            viewport.classList.remove("is-dragging");
            setTransform(0);
            return;
          }
        }
        if (axis !== "x") return;
        e.preventDefault();
        dx = mx;
        setTransform(dx);
      },
      { passive: false }
    );
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove("is-dragging");
      var w = viewport.offsetWidth || 1;
      var threshold = Math.min(72, w * 0.18);
      var flick = Math.abs(dx) > 20 && Date.now() - startT < 280;
      if (dx < -threshold || (flick && dx < 0)) goTo(index + 1);
      else if (dx > threshold || (flick && dx > 0)) goTo(index - 1);
      else goTo(index);
      dx = 0;
      axis = null;
    }
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    return {
      goTo: goTo,
      next: function () {
        goTo(index + 1);
      },
      prev: function () {
        goTo(index - 1);
      },
      index: function () {
        return index;
      },
    };
  }

  function openDetail(id, kind) {
    var item = findItem(id, kind);
    if (!item) return;

    var photos = item.photos || [];
    // Prefer cover image as first displayed; if a video exists, open on it so clips play immediately
    var startIdx = 0;
    var videoIdx = -1;
    for (var i = 0; i < photos.length; i++) {
      if (isVideoMedia(photos[i])) {
        videoIdx = i;
        break;
      }
    }
    if (videoIdx >= 0) {
      startIdx = videoIdx;
    } else if (item.cover_image) {
      for (var j = 0; j < photos.length; j++) {
        if (photos[j].src === item.cover_image) {
          startIdx = j;
          break;
        }
      }
    }
    var activePhoto = photos[startIdx] || photos[0] || {};
    var many = photos.length > 1;
    var chevronL =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    var chevronR =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    var slides = photos
      .map(function (p, i) {
        var label =
          (p.id_detail && p.id_detail.common_name) ||
          p.caption ||
          item.common_name ||
          (isVideoMedia(p) ? "Video " : "Photo ") + (i + 1);
        return (
          '<div class="carousel-slide' +
          (i === startIdx ? " is-active" : "") +
          '" data-idx="' +
          i +
          '" aria-hidden="' +
          (i === startIdx ? "false" : "true") +
          '">' +
          mainMediaHtml(p, label) +
          "</div>"
        );
      })
      .join("");

    var thumbs = many
      ? '<p class="detail-thumb-hint">Swipe, use arrows, or tap a thumbnail · ' +
        photos.length +
        " images</p>" +
        '<div class="detail-photo-nav">' +
        photos
          .map(function (p, i) {
            var label =
              (p.id_detail && p.id_detail.common_name) ||
              p.caption ||
              (isVideoMedia(p) ? "Video " : "Photo ") + (i + 1);
            var tSrc = thumbSrcFor(p);
            return (
              '<button type="button" class="' +
              (i === startIdx ? "is-active" : "") +
              (isVideoMedia(p) ? " is-video" : "") +
              '" data-photo-idx="' +
              i +
              '" title="' +
              escapeHtml(label) +
              '"><img src="' +
              escapeHtml(tSrc) +
              '" alt="' +
              escapeHtml(label) +
              '" />' +
              (isVideoMedia(p) ? '<span class="thumb-video-mark">▶</span>' : "") +
              "</button>"
            );
          })
          .join("") +
        "</div>"
      : "";

    var carousel =
      '<div class="carousel' +
      (many ? "" : " single") +
      '" aria-roledescription="carousel" aria-label="' +
      escapeHtml(item.common_name || "Photos") +
      '">' +
      '<div class="carousel-viewport" tabindex="0">' +
      '<div class="carousel-track">' +
      (slides || "<div class=\"carousel-slide\">" + mainMediaHtml(activePhoto, item.common_name) + "</div>") +
      "</div></div>" +
      (many
        ? '<button type="button" class="carousel-btn carousel-prev" aria-label="Previous photo">' +
          chevronL +
          "</button>" +
          '<button type="button" class="carousel-btn carousel-next" aria-label="Next photo">' +
          chevronR +
          "</button>" +
          '<p class="carousel-counter" aria-live="polite"><span class="carousel-counter-pos">' +
          (startIdx + 1) +
          "</span> / " +
          photos.length +
          "</p>"
        : "") +
      "</div>";

    var subs =
      item.subcategories && item.subcategories.length
        ? '<div class="detail-block" style="padding:0 1.75rem 1rem"><h3>Subcategories in this group</h3><ul class="subcat-list">' +
          item.subcategories
            .map(function (s) {
              return (
                "<li><strong>" +
                escapeHtml(s.name) +
                "</strong>" +
                (s.note ? " — " + escapeHtml(s.note) : "") +
                "</li>"
              );
            })
            .join("") +
          "</ul></div>"
        : "";

    els.detail.innerHTML =
      '<div class="detail-hero">' +
      '<div class="detail-photos" id="detail-photos-main">' +
      carousel +
      thumbs +
      "</div>" +
      '<div id="detail-id-wrap">' +
      renderIdPanel(item, activePhoto) +
      "</div></div>" +
      subs;

    if (modalCloseTimer) clearTimeout(modalCloseTimer);
    lastFocus = document.activeElement;
    els.modal.classList.remove("is-closing");
    els.modal.hidden = false;
    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    requestAnimationFrame(function () {
      els.modal.classList.add("is-open");
    });
    var closeBtn = els.modal.querySelector(".modal-close");
    if (closeBtn) closeBtn.focus();

    var wrap = document.getElementById("detail-id-wrap");
    detailCarousel = bindCarousel(
      els.detail,
      photos.length ? photos : [activePhoto],
      startIdx,
      function (idx, photo) {
        if (wrap) wrap.innerHTML = renderIdPanel(item, photo || {});
      }
    );
    markImagesLoaded(els.detail);
  }

  function closeModal() {
    if (!els.modal || els.modal.hidden) return;
    pauseVideos();
    detailCarousel = null;
    els.modal.classList.remove("is-open");
    els.modal.classList.add("is-closing");
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    var wait = reduceMotion() ? 0 : 280;
    if (modalCloseTimer) clearTimeout(modalCloseTimer);
    modalCloseTimer = setTimeout(function () {
      els.modal.hidden = true;
      els.modal.classList.remove("is-closing");
      els.detail.innerHTML = "";
      if (lastFocus && typeof lastFocus.focus === "function") {
        try {
          lastFocus.focus();
        } catch (e) {}
      }
      lastFocus = null;
    }, wait);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 6 * 1024 * 1024) {
        reject(new Error("Please use an image under 6 MB."));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read that image."));
      };
      reader.readAsDataURL(file);
    });
  }

  function setMetaStatus(msg, kind) {
    var el = document.getElementById("meta-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("is-warn", "is-error");
    if (kind === "warn") el.classList.add("is-warn");
    if (kind === "error") el.classList.add("is-error");
  }

  function reverseGeocode(lat, lon) {
    var url =
      "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" +
      encodeURIComponent(lat) +
      "&longitude=" +
      encodeURIComponent(lon) +
      "&localityLanguage=en";
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("geocode failed");
        return r.json();
      })
      .then(function (data) {
        var parts = [];
        if (data.locality) parts.push(data.locality);
        else if (data.city) parts.push(data.city);
        if (data.principalSubdivisionCode) {
          var code = String(data.principalSubdivisionCode).replace(/^[A-Z]+-/, "");
          if (code) parts.push(code);
        } else if (data.principalSubdivision) {
          parts.push(data.principalSubdivision);
        }
        return parts.filter(Boolean).join(", ") || lat.toFixed(5) + ", " + lon.toFixed(5);
      });
  }

  function readPhotoMeta(file) {
    if (typeof exifr === "undefined") {
      return Promise.resolve({ lat: null, lon: null, label: null });
    }
    return exifr
      .gps(file)
      .then(function (gps) {
        if (!gps || gps.latitude == null) return { lat: null, lon: null, label: null };
        var lat = gps.latitude;
        var lon = gps.longitude;
        return reverseGeocode(lat, lon)
          .then(function (label) {
            return { lat: lat, lon: lon, label: label };
          })
          .catch(function () {
            return {
              lat: lat,
              lon: lon,
              label: lat.toFixed(5) + "°, " + lon.toFixed(5) + "°",
            };
          });
      })
      .catch(function () {
        return { lat: null, lon: null, label: null };
      });
  }

  function setupUpload() {
    if (!els.photo || !els.form) return;

    els.photo.addEventListener("change", function () {
      var file = els.photo.files && els.photo.files[0];
      if (!file) {
        els.preview.hidden = true;
        els.preview.innerHTML = "";
        setMetaStatus("");
        return;
      }
      setMetaStatus("Reading photo metadata…");
      fileToDataUrl(file).then(function (url) {
        els.preview.hidden = false;
        els.preview.innerHTML = '<img src="' + url + '" alt="Preview" />';
      });
      readPhotoMeta(file).then(function (meta) {
        if (meta.lat != null) {
          document.getElementById("up-lat").value = String(meta.lat);
          document.getElementById("up-lon").value = String(meta.lon);
          if (meta.label) document.getElementById("up-location").value = meta.label;
          setMetaStatus(
            "GPS found → " +
              (meta.label || meta.lat.toFixed(5) + ", " + meta.lon.toFixed(5)) +
              ". You can edit the location name."
          );
        } else {
          document.getElementById("up-lat").value = "";
          document.getElementById("up-lon").value = "";
          setMetaStatus(
            "No GPS in this file. Enter location manually (enable Location Services next time).",
            "warn"
          );
        }
      });
    });

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      els.status.classList.remove("error");
      els.status.textContent = "Uploading…";
      var file = els.photo.files && els.photo.files[0];
      if (!file) {
        els.status.textContent = "Please choose a photo.";
        els.status.classList.add("error");
        return;
      }
      var location = document.getElementById("up-location").value.trim();
      var notes = document.getElementById("up-notes").value.trim();
      var lat = parseFloat(document.getElementById("up-lat").value);
      var lon = parseFloat(document.getElementById("up-lon").value);
      if (!location) {
        els.status.textContent = "Please enter a location (or use a geotagged photo).";
        els.status.classList.add("error");
        return;
      }
      var prepare =
        window.TrailPersist && TrailPersist.prepareImage
          ? TrailPersist.prepareImage(file)
          : fileToDataUrl(file);
      prepare
        .then(function (dataUrl) {
          var entry = {
            id:
              window.TrailPersist && TrailPersist.newId
                ? TrailPersist.newId()
                : "pending-" + Date.now(),
            source: "community",
            pending_id: true,
            status: "pending",
            common_name: "Unidentified find",
            scientific_name: "Pending identification",
            category: "Pending ID",
            category_slug: "other",
            edibility: "Unknown — do not eat",
            confidence: "pending",
            summary:
              "Awaiting identification." + (notes ? " Note: " + notes : ""),
            uses: "Not assessed until identified.",
            habitat: notes || "See photo and location.",
            tree_associates: "Not yet determined.",
            field_marks: "See photo.",
            season: "Not specified",
            region_notes: location,
            location: location,
            notes: notes || "",
            photos: [
              {
                src: dataUrl,
                caption: "Pending ID",
                view: "top",
                location: location,
                lat: isFinite(lat) ? lat : undefined,
                lon: isFinite(lon) ? lon : undefined,
              },
            ],
            contributor: "Community",
            uploaded_at: new Date().toISOString(),
          };
          if (isFinite(lat) && isFinite(lon)) {
            entry.gps = { lat: lat, lon: lon };
            entry.location_source = "exif_gps";
          }
          if (window.TrailPersist) {
            return TrailPersist.saveUpload(entry);
          }
          community.unshift(entry);
          saveCommunity();
          return { entry: entry, mode: "localStorage", demo: true };
        })
        .then(function (result) {
          var saved = (result && result.entry) || result;
          upsertCommunity(saved);
          els.form.reset();
          els.preview.hidden = true;
          els.preview.innerHTML = "";
          setMetaStatus("");
          var demo = result && (result.demo || result.fallback);
          els.status.textContent = demo
            ? "Uploaded as Pending ID (saved in this browser for demo). Filter “Pending ID” to review later."
            : "Uploaded — pending review. You can see it on this device; it appears for everyone after approval.";
          viewMode = "mushrooms";
          activeFilter = "pending";
          visibleCount = PAGE_SIZE;
          updateViewChrome();
          renderGallery();
          if (trailMap && mapData) renderMapRegion(activeMapRegion);
        })
        .catch(function (err) {
          els.status.textContent = err.message || "Upload failed.";
          els.status.classList.add("error");
        });
    });
  }

  /* -------- Maps -------- */
  var trailMap = null;
  var mapLayers = { markers: null };
  var mapData = null;
  var activeMapRegion = "sourland";

  function collectFinds() {
    var finds = [];
    function pushItem(item, isPending) {
      (item.photos || []).forEach(function (p, i) {
        var lat = p.lat;
        var lon = p.lon;
        if ((lat == null || lon == null) && p.id_detail) {
          lat = lat != null ? lat : p.id_detail.lat;
          lon = lon != null ? lon : p.id_detail.lon;
        }
        if (lat == null && item.gps) {
          lat = item.gps.lat;
          lon = item.gps.lon;
        }
        if (lat == null || lon == null) return;
        lat = Number(lat);
        lon = Number(lon);
        if (!isFinite(lat) || !isFinite(lon)) return;
        var detail = p.id_detail || {};
        finds.push({
          species_id: item.id,
          common_name: detail.common_name || item.common_name,
          scientific_name: detail.scientific_name || item.scientific_name,
          category: item.category || "",
          category_slug: item.category_slug,
          thumb: isVideoMedia(p) ? p.poster || p.src : p.src,
          caption: p.caption || "",
          location: p.location || detail.photo_location || item.location || "",
          taken_at: p.taken_at || detail.taken_at || "",
          season: item.season || "",
          lat: lat,
          lon: lon,
          photo_index: i,
          pending_id: !!isPending || !!item.pending_id,
          source: item.source || (item.category_slug === "wildlife" ? "wildlife" : "curated"),
          kind:
            item.category_slug === "wildlife"
              ? "wildlife"
              : item.source === "community"
                ? "community"
                : "group",
        });
      });
    }
    mushroomGroups().forEach(function (g) {
      pushItem(g, g.pending_id);
    });
    wildlifeItems().forEach(function (w) {
      pushItem(w, false);
    });
    community.forEach(function (c) {
      if (c && c.status === "rejected") return;
      pushItem(c, true);
    });
    return finds;
  }

  function matchesSearchFind(f) {
    var q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [f.common_name, f.scientific_name, f.location, f.caption, f.category, f.season]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .indexOf(q) !== -1;
  }

  function matchesMapFind(f) {
    if (viewMode === "wildlife") {
      return f.kind === "wildlife" && matchesSearchFind(f);
    }
    if (f.kind === "wildlife") return false;
    if (activeFilter === "favorites") return isFav(f.species_id) && matchesSearchFind(f);
    if (activeFilter === "community") return f.kind === "community" && matchesSearchFind(f);
    if (activeFilter === "pending") return !!f.pending_id && matchesSearchFind(f);
    if (activeFilter !== "all" && f.category_slug !== activeFilter) return false;
    return matchesSearchFind(f);
  }

  function getMapRegion(regionId) {
    if (regionId === "all") {
      return {
        id: "all",
        name: "All parks",
        subtitle: "Every geotagged find across the atlas — zoom in to spiderfy clusters",
        zoom: 8,
        center: [41.15, -73.9],
      };
    }
    return mapData && mapData.regions[regionId];
  }

  function findsInRegion(regionId, finds) {
    if (regionId === "all") return finds;
    if (!mapData || !mapData.regions[regionId]) return [];
    var f = mapData.regions[regionId].filter;
    if (!f) return [];
    return finds.filter(function (x) {
      return (
        x.lat >= f.lat_min &&
        x.lat <= f.lat_max &&
        x.lon >= f.lon_min &&
        x.lon <= f.lon_max
      );
    });
  }

  function makeMarkerLayer() {
    if (typeof L !== "undefined" && typeof L.markerClusterGroup === "function") {
      return L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 52,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 17,
        chunkedLoading: true,
      });
    }
    return L.layerGroup();
  }

  var PARK_ORDER = [
    "all",
    "sourland",
    "baldpate",
    "delaware-water-gap",
    "middlesex-fells",
    "high-point",
    "cheesequake",
  ];
  var PARK_SHORT = {
    all: "All parks",
    sourland: "Sourland",
    baldpate: "Baldpate",
    "delaware-water-gap": "Water Gap",
    "middlesex-fells": "Middlesex Fells",
    "high-point": "High Point",
    cheesequake: "Cheesequake",
  };

  function buildMapTabs() {
    var tabs = document.getElementById("map-tabs");
    if (!tabs || !mapData) return;
    var ids = PARK_ORDER.filter(function (id) {
      return id === "all" || (mapData.regions && mapData.regions[id]);
    });
    Object.keys(mapData.regions || {}).forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    tabs.innerHTML = ids
      .map(function (id) {
        var name = PARK_SHORT[id] || (mapData.regions[id] && mapData.regions[id].name) || id;
        var on = id === activeMapRegion;
        return (
          '<button type="button" class="map-tab' +
          (on ? " is-active" : "") +
          '" role="tab" aria-selected="' +
          (on ? "true" : "false") +
          '" data-map="' +
          escapeHtml(id) +
          '">' +
          escapeHtml(name) +
          "</button>"
        );
      })
      .join("");
    tabs.querySelectorAll(".map-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        renderMapRegion(tab.getAttribute("data-map"));
      });
    });
  }

  function popupHtml(f) {
    return (
      '<div class="map-popup">' +
      (f.thumb
        ? '<img class="popup-thumb" src="' + escapeHtml(f.thumb) + '" alt="' + escapeHtml(f.common_name) + '" />'
        : "") +
      (f.category ? '<p class="popup-cat">' + escapeHtml(f.category) + "</p>" : "") +
      "<strong>" +
      escapeHtml(f.common_name) +
      "</strong><em>" +
      escapeHtml(f.scientific_name || "") +
      "</em><p class='popup-meta'>" +
      escapeHtml(
        [formatTakenAt(f.taken_at), f.location || "", f.pending_id ? "Pending ID" : ""]
          .filter(Boolean)
          .join(" · ")
      ) +
      '</p><button type="button" data-open-species="' +
      escapeHtml(f.species_id) +
      '" data-kind="' +
      escapeHtml(f.kind) +
      '">View details</button></div>'
    );
  }

  function pinIcon(pending) {
    var color = pending ? "#c45c26" : "#2f4f3e";
    return L.divIcon({
      className: "map-pin-icon",
      html:
        '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:' +
        color +
        ';border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-45deg);"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 18],
      popupAnchor: [0, -16],
    });
  }

  /** Jump map to a region (handles long-distance tab switches like NJ → MA). */
  function focusMapOnRegion(region, markers) {
    if (!trailMap || !region) return;
    trailMap.invalidateSize();

    function applyView() {
      trailMap.invalidateSize();
      var used = false;
      if (markers && markers.length) {
        try {
          var fg = L.featureGroup(markers);
          var b = fg.getBounds();
          if (b && b.isValid()) {
            trailMap.fitBounds(b.pad(0.25), { maxZoom: 15, animate: false });
            used = true;
          }
        } catch (e) {
          used = false;
        }
      }
      if (!used && region.bounds && region.bounds.length === 2) {
        try {
          trailMap.fitBounds(region.bounds, { maxZoom: region.zoom || 13, animate: false });
          used = true;
        } catch (e2) {
          used = false;
        }
      }
      if (!used && region.center) {
        trailMap.setView(region.center, region.zoom || 13, { animate: false });
      }
      // Second pass after layout settles (fixes gray tiles on first paint)
      setTimeout(function () {
        trailMap.invalidateSize();
      }, 100);
    }

    // Defer so Leaflet recalculates container size after tab UI updates
    requestAnimationFrame(function () {
      setTimeout(applyView, 50);
    });
  }

  function renderMapRegion(regionId) {
    if (!trailMap || !mapData) return;
    var region = getMapRegion(regionId);
    if (!region) {
      console.error("Unknown map region:", regionId, "known:", Object.keys(mapData.regions || {}));
      var titleEl = document.getElementById("map-region-title");
      if (titleEl) titleEl.textContent = "Map region unavailable";
      return;
    }
    activeMapRegion = regionId;
    document.getElementById("map-region-title").textContent = region.name;
    document.getElementById("map-region-sub").textContent = region.subtitle || "";
    document.querySelectorAll(".map-tab").forEach(function (tab) {
      var on = tab.getAttribute("data-map") === regionId;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    syncFilterChips();
    if (mapLayers.markers) trailMap.removeLayer(mapLayers.markers);
    mapLayers.markers = makeMarkerLayer().addTo(trailMap);
    var finds = findsInRegion(regionId, collectFinds()).filter(matchesMapFind);
    var countEl = document.getElementById("map-find-count");
    if (countEl) {
      countEl.textContent =
        finds.length +
        (finds.length === 1 ? " tagged find" : " tagged finds") +
        (activeFilter !== "all" || viewMode === "wildlife" || searchQuery ? " (filtered)" : "");
    }

    var list = document.getElementById("map-find-list");
    if (!finds.length) {
      list.innerHTML =
        "<li class='map-empty'>No geotagged finds in this park for the current filters. Photos with GPS will appear here automatically.</li>";
    } else {
      list.innerHTML = finds
        .map(function (f, idx) {
          return (
            '<li><button type="button" data-find-idx="' +
            idx +
            '">' +
            (f.thumb ? '<img src="' + escapeHtml(f.thumb) + '" alt="" loading="lazy" />' : "<span></span>") +
            "<div><strong>" +
            escapeHtml(f.common_name) +
            "</strong><span>" +
            escapeHtml(
              [formatTakenAt(f.taken_at), f.caption || f.scientific_name || ""]
                .filter(Boolean)
                .join(" · ")
            ) +
            "</span></div></button></li>"
          );
        })
        .join("");
    }

    var markerByIdx = [];
    finds.forEach(function (f, idx) {
      var marker = L.marker([f.lat, f.lon], { icon: pinIcon(f.pending_id) });
      marker.bindPopup(popupHtml(f), { maxWidth: 280, className: "map-popup-wrap" });
      marker.on("popupopen", function () {
        var btn = document.querySelector(".leaflet-popup-content [data-open-species]");
        if (btn) {
          btn.onclick = function () {
            openDetail(btn.getAttribute("data-open-species"), btn.getAttribute("data-kind"));
          };
        }
      });
      mapLayers.markers.addLayer(marker);
      markerByIdx[idx] = marker;
    });

    list.querySelectorAll("button[data-find-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-find-idx"), 10);
        var m = markerByIdx[idx];
        if (m) {
          if (mapLayers.markers.zoomToShowLayer) {
            mapLayers.markers.zoomToShowLayer(m, function () {
              m.openPopup();
            });
          } else {
            trailMap.setView(m.getLatLng(), Math.max(trailMap.getZoom(), 15));
            m.openPopup();
          }
        }
      });
    });

    focusMapOnRegion(region, markerByIdx.filter(Boolean));
  }

  function setupMaps() {
    if (!document.getElementById("trail-map") || typeof L === "undefined") return;
    fetch("data/map-finds.json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("map-finds.json HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        mapData = data;
        trailMap = L.map("trail-map", { scrollWheelZoom: false });
        var osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        });
        var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          maxZoom: 17,
          attribution: "OpenTopoMap",
        });
        osm.addTo(trailMap);
        L.control.layers({ Streets: osm, Terrain: topo }).addTo(trailMap);
        buildMapTabs();
        setTimeout(function () {
          trailMap.invalidateSize();
          renderMapRegion("sourland");
        }, 200);
        var mapsSection = document.getElementById("maps");
        if (mapsSection && "IntersectionObserver" in window) {
          var mapSeen = false;
          new IntersectionObserver(
            function (entries) {
              entries.forEach(function (en) {
                if (!en.isIntersecting || !trailMap) return;
                trailMap.invalidateSize();
                // First time the map scrolls into view, re-focus so tiles aren't gray
                if (!mapSeen) {
                  mapSeen = true;
                  if (activeMapRegion && mapData && mapData.regions[activeMapRegion]) {
                    focusMapOnRegion(mapData.regions[activeMapRegion], null);
                  }
                }
              });
            },
            { threshold: 0.15 }
          ).observe(mapsSection);
        }
      })
      .catch(function (err) {
        console.error(err);
        var titleEl = document.getElementById("map-region-title");
        if (titleEl) titleEl.textContent = "Could not load trail maps";
      });
  }

  function setupNewsletter() {
    if (!els.newsletterForm) return;
    els.newsletterForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("nl-email").value.trim();
      var consent = document.getElementById("nl-consent").checked;
      var btn = els.newsletterForm.querySelector('button[type="submit"]');
      els.newsletterStatus.classList.remove("error");
      if (!email || !consent) {
        els.newsletterStatus.textContent = "Please enter your email and accept updates.";
        els.newsletterStatus.classList.add("error");
        return;
      }
      els.newsletterStatus.textContent = "Signing you up…";
      if (btn) btn.disabled = true;
      var submit = window.TrailPersist
        ? TrailPersist.subscribeNewsletter(email)
        : Promise.resolve({ demo: true }).then(function (res) {
            var list = [];
            try {
              list = JSON.parse(localStorage.getItem(NEWSLETTER_KEY) || "[]");
            } catch (err) {
              list = [];
            }
            if (list.indexOf(email.toLowerCase()) === -1) {
              list.push(email.toLowerCase());
              localStorage.setItem(NEWSLETTER_KEY, JSON.stringify(list));
            }
            return res;
          });
      submit
        .then(function (result) {
          els.newsletterForm.reset();
          els.newsletterStatus.textContent =
            result && result.demo
              ? "You're on the list — thanks! (Demo storage in this browser.)"
              : "You're on the list — thanks!";
        })
        .catch(function (err) {
          els.newsletterStatus.textContent = err.message || "Signup failed. Please try again.";
          els.newsletterStatus.classList.add("error");
        })
        .then(function () {
          if (btn) btn.disabled = false;
        });
    });
  }

  function updateViewChrome() {
    var chipBar = document.getElementById("mushroom-filters");
    var wildlifeNote = document.getElementById("wildlife-note");
    if (chipBar) {
      chipBar.querySelectorAll(".chip").forEach(function (c) {
        var f = c.getAttribute("data-filter");
        var wildlifeOk = f === "all" || f === "favorites";
        c.hidden = viewMode === "wildlife" && !wildlifeOk;
      });
    }
    if (wildlifeNote) wildlifeNote.hidden = viewMode !== "wildlife";
    document.querySelectorAll("[data-view]").forEach(function (a) {
      a.classList.toggle("is-active-view", a.getAttribute("data-view") === viewMode);
    });
    syncFilterChips();
  }

  function setView(mode, opts) {
    opts = opts || {};
    viewMode = mode === "wildlife" ? "wildlife" : "mushrooms";
    if (activeFilter !== "favorites") activeFilter = "all";
    visibleCount = PAGE_SIZE;
    updateViewChrome();
    renderGallery();
    if (!opts.skipMap && trailMap && mapData) renderMapRegion(activeMapRegion);
    if (opts.scroll !== false) {
      var gal = document.getElementById("gallery");
      if (gal) gal.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    }
  }

  function setupChrome() {
    function onScroll() {
      if (els.header) els.header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    if (els.toggle && els.mobileNav) {
      els.toggle.addEventListener("click", function () {
        var open = els.toggle.getAttribute("aria-expanded") === "true";
        els.toggle.setAttribute("aria-expanded", String(!open));
        els.mobileNav.classList.toggle("is-open", !open);
      });
      els.mobileNav.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () {
          els.toggle.setAttribute("aria-expanded", "false");
          els.mobileNav.classList.remove("is-open");
        });
      });
    }

    els.search.addEventListener("input", function () {
      searchQuery = els.search.value;
      els.clear.hidden = !searchQuery;
      visibleCount = PAGE_SIZE;
      renderGallery();
      if (trailMap && mapData) renderMapRegion(activeMapRegion);
    });
    els.clear.addEventListener("click", function () {
      els.search.value = "";
      searchQuery = "";
      els.clear.hidden = true;
      visibleCount = PAGE_SIZE;
      renderGallery();
      if (trailMap && mapData) renderMapRegion(activeMapRegion);
    });

    if (els.sort) {
      els.sort.value = sortMode;
      els.sort.addEventListener("change", function () {
        sortMode = els.sort.value || "name";
        visibleCount = PAGE_SIZE;
        renderGallery();
      });
    }

    if (els.emptyReset) {
      els.emptyReset.addEventListener("click", function () {
        searchQuery = "";
        if (els.search) els.search.value = "";
        if (els.clear) els.clear.hidden = true;
        if (els.sort) {
          els.sort.value = "name";
          sortMode = "name";
        }
        setFilter("all");
      });
    }

    if (els.loadMore) {
      els.loadMore.addEventListener("click", loadMoreGallery);
    }
    if (els.sentinel && "IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            if (els.empty && !els.empty.hidden) return;
            loadMoreGallery();
          });
        },
        { rootMargin: "280px 0px" }
      ).observe(els.sentinel);
    }

    document.querySelectorAll("#mushroom-filters .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        setFilter(chip.getAttribute("data-filter"));
      });
    });
    var mapFilters = document.getElementById("map-filters");
    if (mapFilters) {
      mapFilters.addEventListener("click", function (e) {
        var chip = e.target.closest("[data-filter]");
        if (!chip) return;
        var f = chip.getAttribute("data-filter");
        if (f === "wildlife") {
          setView("wildlife", { scroll: false });
          return;
        }
        if (viewMode === "wildlife") viewMode = "mushrooms";
        setFilter(f);
      });
    }

    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        setView(el.getAttribute("data-view"));
      });
    });

    els.modal.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", function (e) {
      if (!els.modal || els.modal.hidden) return;
      if (e.key === "Escape") {
        closeModal();
        return;
      }
      if (!detailCarousel) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        detailCarousel.prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        detailCarousel.next();
      }
    });
  }

  function initAbout() {
    if (!catalog.site) return;
    els.aboutDisclaimer.textContent = catalog.site.disclaimer || "";
    if (catalog.site.authors) {
      els.aboutAuthors.textContent = "Curated by " + catalog.site.authors.join(", ") + ".";
    }
  }

  fetch("data/mushrooms.json")
    .then(function (r) {
      if (!r.ok) throw new Error("Could not load data");
      return r.json();
    })
    .then(function (data) {
      catalog = data;
      loadCommunity();
      loadFavorites();
      initAbout();
      setupChrome();
      setupUpload();
      setupNewsletter();
      setupMaps();
      updateViewChrome();
      renderGallery();
      hydrateCommunity();
    })
    .catch(function (err) {
      console.error(err);
      els.grid.setAttribute("aria-busy", "false");
      els.grid.innerHTML =
        '<p class="empty-state">Failed to load atlas. Serve over HTTP (python3 -m http.server).</p>';
    });
})();

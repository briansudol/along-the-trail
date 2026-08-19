(function () {
  "use strict";

  var STORAGE_KEY = "mushroom-atlas-community-v1";
  var NEWSLETTER_KEY = "mushroom-atlas-newsletter-v1";
  var catalog = null;
  var community = [];
  var activeFilter = "all";
  var searchQuery = "";
  var viewMode = "mushrooms"; // mushrooms | wildlife

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
  };

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

  function mainMediaHtml(media) {
    if (!media || !media.src) return '<img id="detail-main-img" src="" alt="" />';
    if (isVideoMedia(media)) {
      var poster = media.poster ? ' poster="' + escapeHtml(media.poster) + '"' : "";
      return (
        '<video id="detail-main-video" class="detail-main-video" controls playsinline preload="metadata"' +
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
      '<img id="detail-main-img" src="' + escapeHtml(media.src) + '" alt="" />'
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
    var items = filteredItems();
    var noun =
      viewMode === "wildlife"
        ? items.length === 1
          ? "wildlife entry"
          : "wildlife entries"
        : items.length === 1
          ? "group"
          : "groups";
    els.count.textContent =
      items.length +
      " " +
      noun +
      (searchQuery || activeFilter !== "all" ? " shown" : " in the atlas");

    if (els.galleryTitle) {
      els.galleryTitle.textContent =
        viewMode === "wildlife" ? "Wildlife of the trail" : "Mushroom groups";
    }

    if (!items.length) {
      els.grid.innerHTML = "";
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    els.grid.innerHTML = items
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
        var sub =
          item.subcategories && item.subcategories.length
            ? '<p class="card-loc">' +
              escapeHtml(
                item.subcategories
                  .map(function (s) {
                    return s.name;
                  })
                  .join(" · ")
              ) +
              "</p>"
            : "";

        return (
          '<button type="button" class="card" data-id="' +
          escapeHtml(item.id) +
          '" data-kind="' +
          (viewMode === "wildlife" ? "wildlife" : item.is_group ? "group" : "community") +
          '" aria-label="' +
          escapeHtml(
            item.common_name +
              ". " +
              galleryCountText(item) +
              ". Click to open."
          ) +
          '">' +
          cardMediaHtml(item) +
          '<div class="card-body">' +
          '<span class="card-category">' +
          escapeHtml(item.category || "") +
          "</span>" +
          '<h3 class="card-title">' +
          escapeHtml(item.common_name) +
          "</h3>" +
          '<p class="card-sci">' +
          escapeHtml(item.scientific_name || "") +
          "</p>" +
          sub +
          (loc && !sub ? '<p class="card-loc">' + escapeHtml(loc) + "</p>" : "") +
          (pending ? "" : edibilityBadge(item.edibility)) +
          badges +
          "</div></button>"
        );
      })
      .join("");

    els.grid.querySelectorAll(".card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDetail(btn.getAttribute("data-id"), btn.getAttribute("data-kind"));
      });
    });
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

    var thumbs =
      photos.length > 1
        ? '<p class="detail-thumb-hint">Click any photo to view it · ' +
          photos.length +
          (photos.length === 1 ? " image" : " images") +
          "</p>" +
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
      mainMediaHtml(activePhoto) +
      thumbs +
      "</div>" +
      '<div id="detail-id-wrap">' +
      renderIdPanel(item, activePhoto) +
      "</div></div>" +
      subs;

    els.modal.hidden = false;
    document.body.classList.add("modal-open");

    function setDetailMedia(p) {
      var host = document.getElementById("detail-photos-main");
      if (!host || !p) return;
      // Keep thumbs; replace only the main media element(s)
      var hint = host.querySelector(".detail-thumb-hint");
      var nav = host.querySelector(".detail-photo-nav");
      var navHtml =
        (hint ? hint.outerHTML : "") + (nav ? nav.outerHTML : "");
      host.innerHTML = mainMediaHtml(p) + navHtml;
      // re-bind thumb clicks after replacing nav
      host.querySelectorAll(".detail-photo-nav button").forEach(function (btn) {
        btn.addEventListener("click", onThumbClick);
      });
    }

    function onThumbClick() {
      var idx = parseInt(this.getAttribute("data-photo-idx"), 10);
      var p = photos[idx];
      // pause any playing video before swap
      var playing = els.detail.querySelector("video");
      if (playing) {
        try {
          playing.pause();
        } catch (e) {}
      }
      setDetailMedia(p);
      els.detail.querySelectorAll(".detail-photo-nav button").forEach(function (b) {
        b.classList.remove("is-active");
      });
      var activeBtn = els.detail.querySelector(
        '.detail-photo-nav button[data-photo-idx="' + idx + '"]'
      );
      if (activeBtn) activeBtn.classList.add("is-active");
      var wrap = document.getElementById("detail-id-wrap");
      if (wrap) wrap.innerHTML = renderIdPanel(item, p);
    }

    els.detail.querySelectorAll(".detail-photo-nav button").forEach(function (btn) {
      btn.addEventListener("click", onThumbClick);
    });
  }

  function closeModal() {
    var playing = els.detail ? els.detail.querySelector("video") : null;
    if (playing) {
      try {
        playing.pause();
      } catch (e) {}
    }
    els.modal.hidden = true;
    document.body.classList.remove("modal-open");
    els.detail.innerHTML = "";
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
      fileToDataUrl(file)
        .then(function (dataUrl) {
          var entry = {
            id: "pending-" + Date.now(),
            source: "community",
            pending_id: true,
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
          community.unshift(entry);
          saveCommunity();
          els.form.reset();
          els.preview.hidden = true;
          els.preview.innerHTML = "";
          setMetaStatus("");
          els.status.textContent =
            "Uploaded as Pending ID. Filter “Pending ID” to review later.";
          viewMode = "mushrooms";
          activeFilter = "pending";
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
          category_slug: item.category_slug,
          thumb: p.src,
          caption: p.caption || "",
          location: p.location || detail.photo_location || item.location || "",
          taken_at: p.taken_at || detail.taken_at || "",
          lat: lat,
          lon: lon,
          photo_index: i,
          pending_id: !!isPending,
          kind: item.category_slug === "wildlife" ? "wildlife" : "group",
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
      pushItem(c, true);
    });
    return finds;
  }

  function findsInRegion(regionId, finds) {
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
    var region = mapData.regions[regionId];
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
    if (mapLayers.markers) trailMap.removeLayer(mapLayers.markers);
    mapLayers.markers = L.layerGroup().addTo(trailMap);
    var finds = findsInRegion(regionId, collectFinds());
    document.getElementById("map-find-count").textContent =
      finds.length + (finds.length === 1 ? " tagged find" : " tagged finds");

    var list = document.getElementById("map-find-list");
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

    var markerByIdx = [];
    finds.forEach(function (f, idx) {
      var marker = L.marker([f.lat, f.lon], { icon: pinIcon(f.pending_id) }).addTo(
        mapLayers.markers
      );
      marker.bindPopup(
        (f.thumb
          ? '<img class="popup-thumb" src="' + escapeHtml(f.thumb) + '" alt="" />'
          : "") +
          "<strong>" +
          escapeHtml(f.common_name) +
          "</strong><em>" +
          escapeHtml(f.scientific_name || "") +
          "</em><div style='font-size:0.8rem;color:#6b756e;margin-top:0.25rem'>" +
          escapeHtml(
            [formatTakenAt(f.taken_at), f.location || ""].filter(Boolean).join(" · ")
          ) +
          '</div><button type="button" data-open-species="' +
          escapeHtml(f.species_id) +
          '" data-kind="' +
          escapeHtml(f.kind) +
          '">View group</button>'
      );
      marker.on("popupopen", function () {
        var btn = document.querySelector(".leaflet-popup-content [data-open-species]");
        if (btn) {
          btn.onclick = function () {
            openDetail(btn.getAttribute("data-open-species"), btn.getAttribute("data-kind"));
          };
        }
      });
      markerByIdx[idx] = marker;
    });

    list.querySelectorAll("button[data-find-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-find-idx"), 10);
        var m = markerByIdx[idx];
        if (m) {
          trailMap.setView(m.getLatLng(), Math.max(trailMap.getZoom(), 15));
          m.openPopup();
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
        document.querySelectorAll(".map-tab").forEach(function (tab) {
          tab.addEventListener("click", function () {
            renderMapRegion(tab.getAttribute("data-map"));
          });
        });
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
      els.newsletterStatus.classList.remove("error");
      if (!email || !consent) {
        els.newsletterStatus.textContent = "Please enter your email and accept updates.";
        els.newsletterStatus.classList.add("error");
        return;
      }
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
      els.newsletterForm.reset();
      els.newsletterStatus.textContent =
        "You're on the list — thanks! (Demo storage in this browser.)";
    });
  }

  function updateViewChrome() {
    var chipBar = document.getElementById("mushroom-filters");
    var wildlifeNote = document.getElementById("wildlife-note");
    if (chipBar) chipBar.hidden = viewMode === "wildlife";
    if (wildlifeNote) wildlifeNote.hidden = viewMode !== "wildlife";
    document.querySelectorAll("[data-view]").forEach(function (a) {
      a.classList.toggle("is-active-view", a.getAttribute("data-view") === viewMode);
    });
  }

  function setView(mode) {
    viewMode = mode === "wildlife" ? "wildlife" : "mushrooms";
    activeFilter = "all";
    document.querySelectorAll(".chip").forEach(function (c) {
      c.classList.toggle("is-active", c.getAttribute("data-filter") === "all");
    });
    updateViewChrome();
    renderGallery();
    var gal = document.getElementById("gallery");
    if (gal) gal.scrollIntoView({ behavior: "smooth" });
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
      renderGallery();
    });
    els.clear.addEventListener("click", function () {
      els.search.value = "";
      searchQuery = "";
      els.clear.hidden = true;
      renderGallery();
    });

    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        activeFilter = chip.getAttribute("data-filter");
        document.querySelectorAll(".chip").forEach(function (c) {
          c.classList.toggle("is-active", c === chip);
        });
        // mushroom filters imply mushroom view
        if (viewMode === "wildlife") {
          viewMode = "mushrooms";
          updateViewChrome();
        }
        renderGallery();
      });
    });

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
      if (e.key === "Escape" && !els.modal.hidden) closeModal();
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
      initAbout();
      setupChrome();
      setupUpload();
      setupNewsletter();
      setupMaps();
      updateViewChrome();
      renderGallery();
    })
    .catch(function (err) {
      console.error(err);
      els.grid.innerHTML =
        '<p class="empty-state">Failed to load atlas. Serve over HTTP (python3 -m http.server).</p>';
    });
})();

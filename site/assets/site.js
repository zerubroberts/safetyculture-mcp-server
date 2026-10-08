// SafetyCulture MCP landing page. All content is in the HTML; this file only adds
// copy buttons, the install tabs and motion (GSAP + ScrollTrigger when available).
(function () {
  "use strict";

  var live = document.getElementById("live");
  function announce(text) {
    if (!live) return;
    live.textContent = "";
    window.setTimeout(function () { live.textContent = text; }, 30);
  }

  /* ---------- Copy buttons ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var targetId = btn.getAttribute("data-copy-target");
      if (!text && targetId) {
        var el = document.getElementById(targetId);
        text = el ? el.textContent : "";
      }
      if (!text) return;
      copyText(text).then(function () {
        btn.textContent = "Copied";
        announce("Copied to clipboard");
      }, function () {
        btn.textContent = "Select and copy";
        announce("Copy failed. Select the text and copy it manually.");
      }).then(function () {
        window.clearTimeout(btn._reset);
        btn._reset = window.setTimeout(function () { btn.textContent = "Copy"; }, 1800);
      });
    });
  });

  /* ---------- Install tabs (WAI-ARIA tabs, automatic activation) ---------- */
  document.querySelectorAll("[data-tabs]").forEach(function (root) {
    var list = root.querySelector('[role="tablist"]');
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    if (!list || !tabs.length) return;

    function select(index, focus) {
      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
        if (panels[i]) panels[i].hidden = !on;
      });
      if (focus) tabs[index].focus();
    }

    tabs.forEach(function (tab, i) {
      tab.type = "button";
      tab.addEventListener("click", function () { select(i, false); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next !== null) { e.preventDefault(); select(next, true); }
      });
    });

    panels.forEach(function (p) { if (p) p.tabIndex = 0; });
    list.hidden = false;
    root.classList.add("tabs-ready");
    select(0, false);
  });

  /* ---------- Motion ---------- */
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !window.gsap || !window.ScrollTrigger) return;

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);

  // Hero: copy rises in, panel rows stream in, numbers count up once.
  var heroBlocks = document.querySelectorAll(".hero-copy > *");
  gsap.from(heroBlocks, { y: 16, opacity: 0, duration: 0.9, ease: "expo.out", stagger: 0.06 });

  var panel = document.querySelector(".hero-panel .panel");
  if (panel) {
    gsap.from(panel, { opacity: 0, y: 12, duration: 0.8, ease: "expo.out", delay: 0.15 });
    gsap.from(panel.querySelectorAll("[data-stream]"), {
      opacity: 0, duration: 0.35, ease: "power2.out", stagger: 0.04, delay: 0.35
    });
    panel.querySelectorAll("[data-count]").forEach(function (el, i) {
      var target = parseFloat(el.getAttribute("data-count"));
      var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
      var suffix = el.getAttribute("data-suffix") || "";
      var state = { v: 0 };
      gsap.to(state, {
        v: target, duration: 1.1, ease: "expo.out", delay: 0.4 + i * 0.04,
        onUpdate: function () { el.textContent = state.v.toFixed(decimals) + suffix; },
        onComplete: function () { el.textContent = target.toFixed(decimals) + suffix; }
      });
    });
  }

  var mm = gsap.matchMedia();

  // "What you can ask": pinned on desktop, scroll advances through the 4 featured prompts.
  var ask = document.querySelector(".ask");
  var stage = ask && ask.querySelector(".ask-stage");
  var items = ask ? Array.prototype.slice.call(ask.querySelectorAll(".ask-item")) : [];
  var bars = ask ? Array.prototype.slice.call(ask.querySelectorAll(".ask-progress span")) : [];

  function setActive(index) {
    items.forEach(function (item, i) {
      var was = item.classList.contains("is-active");
      var on = i === index;
      item.classList.toggle("is-active", on);
      if (on && !was) {
        var rows = item.querySelectorAll(".ask-panel .panel-summary, .ask-panel tr, .ask-panel .buckets, .ask-panel .panel-foot");
        gsap.fromTo(rows, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out", stagger: 0.03, overwrite: true });
      }
    });
    bars.forEach(function (b, i) { b.classList.toggle("is-on", i <= index); });
  }

  if (stage && items.length) {
    mm.add("(min-width: 1024px) and (min-height: 700px)", function () {
      ask.classList.add("is-pinned");
      setActive(0);
      var n = items.length;
      var st = ScrollTrigger.create({
        trigger: stage,
        start: function () { return "top top+=" + document.querySelector(".site-header").offsetHeight; },
        end: function () { return "+=" + Math.round(window.innerHeight * 0.75 * n); },
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: function (self) { setActive(Math.min(n - 1, Math.floor(self.progress * n))); }
      });
      var handlers = items.map(function (item, i) {
        var copy = item.querySelector(".ask-copy");
        var fn = function () {
          var y = st.start + (st.end - st.start) * ((i + 0.5) / n);
          window.scrollTo({ top: y, behavior: "smooth" });
        };
        copy.addEventListener("click", fn);
        return { el: copy, fn: fn };
      });
      return function () {
        handlers.forEach(function (h) { h.el.removeEventListener("click", h.fn); });
        ask.classList.remove("is-pinned");
        items.forEach(function (item) { item.classList.remove("is-active"); });
      };
    });
  }

  // Report screenshots: clip-path inset reveal, once.
  document.querySelectorAll(".shot .frame").forEach(function (frame, i) {
    gsap.fromTo(frame, { clipPath: "inset(0% 0% 100% 0% round 10px)" }, {
      clipPath: "inset(0% 0% 0% 0% round 10px)", duration: 1.1, ease: "expo.out", delay: i * 0.12,
      scrollTrigger: { trigger: frame, start: "top 85%", once: true }
    });
  });

  // Safety controls: the connecting rail draws as you read down the list.
  var controls = document.querySelector(".controls");
  if (controls) {
    gsap.fromTo(controls, { "--rail": 0 }, {
      "--rail": 1, ease: "none",
      scrollTrigger: { trigger: controls, start: "top 75%", end: "bottom 60%", scrub: 0.6 }
    });
    gsap.from(controls.querySelectorAll("li"), {
      opacity: 0, x: -8, duration: 0.6, ease: "expo.out", stagger: 0.08,
      scrollTrigger: { trigger: controls, start: "top 80%", once: true }
    });
  }

  // Tools board: counts tick up when the board arrives.
  document.querySelectorAll(".board-count").forEach(function (el) {
    var target = parseInt(el.textContent, 10);
    var state = { v: 0 };
    gsap.to(state, {
      v: target, duration: 0.9, ease: "expo.out",
      scrollTrigger: { trigger: ".board", start: "top 80%", once: true },
      onUpdate: function () { el.textContent = String(Math.round(state.v)); },
      onComplete: function () { el.textContent = String(target); }
    });
  });

  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();

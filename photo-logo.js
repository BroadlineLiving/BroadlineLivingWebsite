/* Broadline logo in the bottom-left corner of every unit photo: gallery
   tiles, the full-screen viewer, and the cards on the home and availability
   pages. Drawn over the photo rather than stamped into the files, so it never
   gets cropped off a tile, never doubles up, and the repo carries no second
   copy of every photo. Styles live in styles.css (.ph-logo). */
(function () {
  var html = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><defs><linearGradient id="phlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fe0d0"/><stop offset="0.5" stop-color="#34c8d6"/><stop offset="1" stop-color="#7b6cf0"/></linearGradient></defs><path d="M8 8 H40 V40 H26" stroke="url(#phlg)" stroke-width="1.6" fill="none"/><path d="M8 8 V40" stroke="url(#phlg)" stroke-width="1.6" fill="none"/><text x="24" y="30" text-anchor="middle" font-family="Jost,sans-serif" font-size="17" font-weight="500" fill="url(#phlg)">B</text></svg><span class="n"><span class="b">BROADLINE</span><span class="l">LIVING</span></span>';
  function logo() { var d = document.createElement('div'); d.className = 'ph-logo'; d.innerHTML = html; return d; }

  document.querySelectorAll('.gimg, .pcard .img, .pcard .ph').forEach(function (el) {
    el.classList.add('has-ph-logo');
    el.appendChild(logo());
  });

  // Full-screen viewer: the photo is letterboxed inside its frame, so pin the
  // logo to the photo's own bottom-left corner, not the frame's.
  var img = document.getElementById('lb-img');
  if (!img) return;
  var frame = img.parentNode, l = logo();
  l.classList.add('lb');
  frame.appendChild(l);
  function place() {
    if (!img.offsetWidth) return;
    l.style.left = img.offsetLeft + 'px';
    l.style.bottom = (frame.clientHeight - img.offsetTop - img.offsetHeight) + 'px';
  }
  img.addEventListener('load', place);
  window.addEventListener('resize', place);
  new MutationObserver(place).observe(document.getElementById('lightbox'), { attributes: true, attributeFilter: ['class'] });
})();

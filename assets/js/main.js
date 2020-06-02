$(document).ready(function() {
  // main menu toggle
  var toggleButton = document.getElementById("menu-toggle");
  var menu = document.getElementById("primary-nav");

  if (toggleButton && menu) {
    toggleButton.addEventListener("click", function() {
      menu.classList.toggle("js-menu-is-open");
    });
  }

  // initialize smooth scroll
  $("a").smoothScroll({ offset: -20 });

  // add lightbox class to all image links
  $("a[href$='.jpg'], a[href$='.png'], a[href$='.gif']").attr("data-lity", "");

  var count = 0;
  var toc = document.querySelector("nav.toc");

  function onActivate(event) {
    if (count++ == 0) {
      toc.classList.add("gumshoe-activated");
    }
  }
  function onDeactivate(event) {
    if (--count == 0) {
      toc.classList.remove("gumshoe-activated");
    }
  }
  document.addEventListener('gumshoeActivate', onActivate);
  document.addEventListener('gumshoeDeactivate', onDeactivate);

  // Gumshoe scroll spy init
  if($("nav.toc").length > 0) {
    var spy = new Gumshoe("nav.toc a", {
      // Active classes
      navClass: "active", // applied to the nav list item
      contentClass: "active", // applied to the content

      // Nested navigation
      nested: false, // if true, add classes to parents of active link
      nestedClass: "active", // applied to the parent items

      // Offset & reflow
      offset: 200, // how far from the top of the page to activate a content area
      reflow: true, // if true, listen for reflows

      // Event support
      events: true // if true, emit custom events
    });
  }
});

---
layout: none
---

var idx = lunr(function () {
  this.field('title')
  this.field('excerpt')
  this.field('categories')
  this.field('tags')
  this.ref('id')

  this.pipeline.remove(lunr.trimmer)

  for (var item in store) {
    this.add({
      title: store[item].title,
      excerpt: store[item].excerpt,
      categories: store[item].categories,
      tags: store[item].tags,
      id: item
    })
  }
});

$(document).ready(function() {
  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInlineResults(result, query) {
    var resultdiv = $('#nav-search-results');
    if (!resultdiv.length) return;

    if (!query) {
      resultdiv.prop('hidden', true).empty();
      return;
    }

    resultdiv.prop('hidden', false).empty();

    if (!result.length) {
      resultdiv.html('<div class="nav-search__empty">没有找到和 “' + escapeHtml(query) + '” 相关的内容</div>');
      return;
    }

    result.slice(0, 6).forEach(function(entry) {
      var ref = entry.ref;
      var meta = store[ref].categories && store[ref].categories.length ? escapeHtml(store[ref].categories[0]) : '文章';
      var excerpt = escapeHtml((store[ref].excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 96));
      var item =
        '<a class="nav-search__item" href="' + escapeHtml(store[ref].url) + '">' +
          '<span class="nav-search__item-meta">' + meta + '</span>' +
          '<strong class="nav-search__item-title">' + escapeHtml(store[ref].title) + '</strong>' +
          '<span class="nav-search__item-excerpt">' + excerpt + '</span>' +
        '</a>';
      resultdiv.append(item);
    });
  }

  $('input#search').on('keyup', function () {
    var resultdiv = $('#results');
    var query = $(this).val().toLowerCase();
    var result =
      idx.query(function (q) {
        query.split(lunr.tokenizer.separator).forEach(function (term) {
          q.term(term, { boost: 100 })
          if(query.lastIndexOf(" ") != query.length-1){
            q.term(term, {  usePipeline: false, wildcard: lunr.Query.wildcard.TRAILING, boost: 10 })
          }
          if (term != ""){
            q.term(term, {  usePipeline: false, editDistance: 1, boost: 1 })
          }
        })
      });
    resultdiv.empty();
    resultdiv.prepend('<p class="results__found">'+result.length+' {{ site.data.ui-text[site.locale].results_found | default: "Result(s) found" }}</p>');
    for (var item in result) {
      var ref = result[item].ref;
      if(store[ref].teaser){
        var searchitem =
          '<div class="list__item">'+
            '<article class="archive__item" itemscope itemtype="https://schema.org/CreativeWork">'+
              '<h2 class="archive__item-title" itemprop="headline">'+
                '<a href="'+store[ref].url+'" rel="permalink">'+store[ref].title+'</a>'+
              '</h2>'+
              '<div class="archive__item-teaser">'+
                '<img src="'+store[ref].teaser+'" alt="">'+
              '</div>'+
              '<p class="archive__item-excerpt" itemprop="description">'+store[ref].excerpt.split(" ").splice(0,20).join(" ")+'...</p>'+
            '</article>'+
          '</div>';
      }
      else{
    	  var searchitem =
          '<div class="list__item">'+
            '<article class="archive__item" itemscope itemtype="https://schema.org/CreativeWork">'+
              '<h2 class="archive__item-title" itemprop="headline">'+
                '<a href="'+store[ref].url+'" rel="permalink">'+store[ref].title+'</a>'+
              '</h2>'+
              '<p class="archive__item-excerpt" itemprop="description">'+store[ref].excerpt.split(" ").splice(0,20).join(" ")+'...</p>'+
            '</article>'+
          '</div>';
      }
      resultdiv.append(searchitem);
    }
  });

  $('input#nav-search-input').on('input', function () {
    var query = $(this).val().toLowerCase();
    var result =
      idx.query(function (q) {
        query.split(lunr.tokenizer.separator).forEach(function (term) {
          q.term(term, { boost: 100 });
          if(query.lastIndexOf(" ") != query.length-1){
            q.term(term, { usePipeline: false, wildcard: lunr.Query.wildcard.TRAILING, boost: 10 });
          }
          if (term != ""){
            q.term(term, { usePipeline: false, editDistance: 1, boost: 1 });
          }
        });
      });

    renderInlineResults(result, query);
  });

  $('input#nav-search-input').on('focus', function () {
    if ($(this).val().trim()) {
      $(this).trigger('input');
    }
  });

  $(document).on('click', function (event) {
    var $target = $(event.target);
    if (!$target.closest('.nav-search').length) {
      $('#nav-search-results').prop('hidden', true);
    }
  });

  $(document).on('keydown', function (event) {
    if (event.key === 'Escape') {
      $('#nav-search-results').prop('hidden', true);
      $('input#nav-search-input').blur();
    }
  });
});

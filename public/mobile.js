(function(){
var bar=document.getElementById("tabbar");if(!bar)return;
bar.innerHTML=[["home","Home","#/home"],["flame","New","#/new"],["search","Search",""],["bookmark","My List","#/mylist"],["user","Profile",""]].map(function(t){
return '<a href="'+(t[2]||"#")+'" data-t="'+t[1]+'">'+VXI(t[0])+'<span>'+t[1]+'</span></a>'}).join("");
bar.addEventListener("click",function(e){var a=e.target.closest("a");if(!a)return;var t=a.dataset.t;
 if(t==="Search"){e.preventDefault();var b=document.getElementById("searchBtn");b&&b.click();var i=document.getElementById("searchInput");i&&i.focus()}
 if(t==="Profile"){e.preventDefault();var p=document.getElementById("profileBtn");p&&p.click()}});
function mark(){var h=location.hash||"#/home";bar.querySelectorAll("a").forEach(function(a){a.classList.toggle("on",a.getAttribute("href")===h.split("?")[0])})}
addEventListener("hashchange",mark);mark();
var nav=document.getElementById("nav");
function sync(){var show=!!nav&&!nav.hidden&&!document.querySelector("#player:not([hidden])");document.body.classList.toggle("has-tabs",!!nav&&!nav.hidden);if(bar.hidden===show)bar.hidden=!show}
var pl=document.getElementById("player");
[nav,pl].forEach(function(el){el&&new MutationObserver(sync).observe(el,{attributes:true,attributeFilter:["hidden"]})});sync();
})();

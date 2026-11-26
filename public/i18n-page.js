// index.html'deki sabit metinler seçili dile çevrilir (bkz. i18n.js). Gövdenin
// sonunda, öbür betikler DOM'a kendi (zaten çevrilmiş) metinlerini koymadan önce çalışır.
I18N.translateDom(document.body);
if (I18N.has(document.title)) document.title = T(document.title);

const showEntries = {
  secret: {
    id: 'secret',
    title: 'Секрет',
    description: 'Иллюзионный моноспектакль Дмитрия Костюка',
    poster: './images/secret.webp',
  },
  huligan: {
    id: 'huligan',
    title: 'Хулиган',
    description: 'Дерзкое иллюзионное шоу Дмитрия Костюка',
    poster: './images/huligan.webp',
  },
  matvey: {
    id: 'matvey',
    title: 'Спасти Матвея',
    description: 'Семейное приключение с фокусами',
    poster: './images/matvey.webp',
  },
};

export const SHOWS = Object.freeze(
  Object.fromEntries(
    Object.entries(showEntries).map(([id, show]) => [id, Object.freeze(show)]),
  ),
);

/** Common / app message type ids used for extraction (TSPRegistry subset). */

export const TYPE = {
  // Pages
  TP_DOCUMENT: 10000,
  TP_PLACEHOLDER: 7,

  // Numbers
  TN_DOCUMENT: 1,
  TN_SHEET: 2,

  // Keynote — Document/Show share low ids with Numbers; distinguished by fields.
  KN_DOCUMENT: 1,
  KN_SHOW: 2,
  KN_SLIDE_NODE: 4,
  KN_SLIDE: 5,
  KN_SLIDE_ALT: 6,
  KN_PLACEHOLDER: 12,

  // Text
  TSWP_STORAGE: 2001,
  TSWP_STORAGE_ALT: 2005,
  TSWP_SHAPE_INFO: 2011,
  TSWP_CHARACTER_STYLE: 2021,
  TSWP_PARAGRAPH_STYLE: 2022,
  TSWP_LIST_STYLE: 2023,
  TSWP_HYPERLINK: 2032,
  TSWP_DRAWABLE_ATTACHMENT: 2003,

  // Drawables / tables
  TSD_DRAWABLE: 3002,
  TSD_SHAPE: 3004,
  TSD_IMAGE: 3005,
  TSD_GROUP: 3008,
  TST_TABLE_INFO: 6000,
  TST_TABLE_MODEL: 6001,
  TST_TILE: 6002,
  TST_TABLE_DATA_LIST: 6005,
  TST_TABLE_DATA_LIST_ALT: 6201,
  TST_RICH_TEXT_PAYLOAD: 6218,
  TST_WP_TABLE_INFO: 6007,
} as const;

export type IWorkKind = 'pages' | 'numbers' | 'keynote';

const TRADITIONAL_YAKU_NAMES = Object.freeze({
  "两立直": "兩立直",
  "一发": "一發",
  "门前清自摸和": "門前清自摸和",
  "岭上开花": "嶺上開花",
  "抢杠": "搶槓",
  "海底捞鱼": "海底撈魚",
  "九莲宝灯": "九蓮寶燈",
  "断幺九": "斷幺九",
  "二杯口": "二盃口",
  "一杯口": "一盃口",
  发: "發",
  "自风": "自風",
  "场风": "場風",
  "对对和": "對對和",
  "三杠子": "三槓子",
  "四杠子": "四槓子",
  "一气通贯": "一氣通貫",
  "三色同顺": "三色同順",
  "混老头": "混老頭",
  "混全带幺九": "混全帶幺九",
  "纯全带幺九": "純全帶幺九",
  "绿一色": "綠一色",
  "国士无双": "國士無雙",
  "七对子": "七對子",
  "河底捞鱼": "河底撈魚",
  "宝牌": "寶牌",
});

const TRADITIONAL_DRAW_REASONS = Object.freeze({
  "九种九牌": "九種九牌",
  "四风连打": "四風連打",
  "四杠散了": "四槓散了",
  "流局满贯": "流局滿貫",
});

export const YAKU_FONT_TEXT = [
  "兩立直", "立直", "一發", "門前清自摸和", "嶺上開花", "搶槓",
  "海底摸月", "河底撈魚", "天和", "地和", "九蓮寶燈", "斷幺九",
  "平和", "二盃口", "一盃口", "白", "發", "中", "自風", "場風",
  "大三元", "大四喜", "小四喜", "小三元", "對對和", "三暗刻",
  "四暗刻", "三槓子", "四槓子", "三色同順", "一氣通貫", "三色同刻",
  "混一色", "清一色", "混老頭", "混全帶幺九", "純全帶幺九", "字一色",
  "清老頭", "綠一色", "國士無雙", "七對子", "寶牌",
].join("");

export function traditionalYakuName(name) {
  const source = String(name ?? "");
  return TRADITIONAL_YAKU_NAMES[source] ?? source;
}

export function traditionalDrawReason(reason) {
  const source = String(reason ?? "");
  return TRADITIONAL_DRAW_REASONS[source] ?? source;
}

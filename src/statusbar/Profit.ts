/**
 * 收益状态栏显示
 * 目前只支持基金
 * TODO: 股票
 */

import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { TIPS_LOSE, TIPS_WIN } from '../shared/constant';
import { LeekFundConfig } from '../shared/leekConfig';
import { ProfitStatusBarInfo } from '../shared/typed';
import { events, formatDate, padStart, toFixed } from '../shared/utils';
import StockService from '../explorer/stockService';
import globalState from '../globalState';
import * as vscode from 'vscode';

const PREFIX = '💰';

export class ProfitStatusBar {
  fundBarItem: StatusBarItem | undefined;
  stockBarItem: StatusBarItem | undefined;
  isEnable: boolean = false;
  hideStatusBar: boolean = false;
  unsubscribe: Function = () => {};
  fallColor: string = 'green';
  riseColor: string = 'red';
  constructor() {
    this.init();
  }

  init() {
    this.isEnable = LeekFundConfig.getConfig('leek-fund.showEarnings');
    this.hideStatusBar = LeekFundConfig.getConfig('leek-fund.hideStatusBar');
    //如果显示收益 && 显示状态栏
    if (this.isEnable && !this.hideStatusBar) {
      this.riseColor = LeekFundConfig.getConfig('leek-fund.riseColor');
      this.fallColor = LeekFundConfig.getConfig('leek-fund.fallColor');
      this.fundBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 2);
      this.fundBarItem.text = `${PREFIX} --`;
      this.fundBarItem.command = 'leek-fund.setFundAmount';
      this.fundBarItem.show();
      this.stockBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 3);
      this.stockBarItem.text = `${PREFIX}  --`;
      this.stockBarItem.command = 'leek-fund.setStockPrice';
      this.stockBarItem.show();

      const profitUpdateListener = (data: ProfitStatusBarInfo) => {
        this.updateFundBarItem(data);
      };
      events.on('updateBar:profit-refresh', profitUpdateListener);
      this.unsubscribe = () => {
        events.off('updateBar:profit-refresh', profitUpdateListener);
        events.off('updateBar:stock-profit-refresh', profitStockUpdateListener);
      };

      const profitStockUpdateListener = (data: StockService) => {
        this.updateStockBarItem(data);
      };
      events.on('updateBar:stock-profit-refresh', profitStockUpdateListener);
    }
  }

  reload() {
    this.riseColor = LeekFundConfig.getConfig('leek-fund.riseColor');
    this.fallColor = LeekFundConfig.getConfig('leek-fund.fallColor');
    const enable: boolean = LeekFundConfig.getConfig('leek-fund.showEarnings');
    const hideStatusBar: boolean = LeekFundConfig.getConfig('leek-fund.hideStatusBar');
    if (this.isEnable !== enable || this.hideStatusBar !== hideStatusBar) {
      this.isEnable = enable;
      this.hideStatusBar = hideStatusBar;
      //如果隐藏状态栏 || 隐藏收益
      if (hideStatusBar || !enable) {
        this.destroy();
      } else {
        this.init();
      }
    }
  }

  updateFundBarItem({ fundProfit = 0, fundProfitPercent = 0, fundAmount = 0, priceDate = '' }) {
    if (this.fundBarItem) {
      this.fundBarItem.text = `${PREFIX} ${fundProfit}`;
      this.fundBarItem.color = fundProfit >= 0 ? this.riseColor : this.fallColor;
      this.fundBarItem.tooltip =
        `「基金收益统计${priceDate}」` +
        [
          ,
          `持仓金额：${fundAmount}元`,
          `今日${fundProfit >= 0 ? '盈利' : '亏损'}：${fundProfit}元`,
          `今日收益率：${fundProfitPercent}%`,
          `${
            fundProfit >= 0
              ? TIPS_WIN[Math.floor(Math.random() * TIPS_WIN.length)]
              : TIPS_LOSE[Math.floor(Math.random() * TIPS_LOSE.length)]
          }`,
        ].join('\r\n-----------------------------\r\n');
      this.fundBarItem.show();
    }
  }

  // TODO
  updateStockBarItem(data: StockService) {
    if (this.stockBarItem) {
      const stockList = data.getSelfSelected();
      type StockInfoType = {
        id: string;
        name: string;
        low: number | string;
        high: number | string;
        open: number | string;
        yestclose: number | string | undefined;
        percent: string;
        price: number | string;
        heldPrice: number;
        amount: number;
        incomeTotal: number | string;
        incomeToday: number | string;
        incomeTotalCNY: number | string;
        incomeTodayCNY: number | string;
        percentToday: string;
        percentTotal: string;
        marketCap: number | string;
      };
      const stockInfo: StockInfoType[] = [];

      const forexList = globalState.forexList;
      stockList.forEach((s) => {
        let tmp = {} as StockInfoType;
        const { id, info } = s;
        const { high, low, open, yestclose, percent, price, name, heldAmount, heldPrice, todayHeldPrice, isSellOut, code } = info;
        if (id && open && price) {
          if (!heldAmount || !heldPrice) {
            return false;
          }
          // const incomeTotal = amount * (Number(price).toFixed(2) - unitPrice.toFixed(2));
          // const incomeToday = amount * (Number(price).toFixed(2) - Number(open).toFixed(2));
          let incomeTotal = (heldAmount * (Number(price) - heldPrice)).toFixed(2);
          // fix #399，在昨日收盘价没有的时候使用今日开盘价
          let incomeToday = (heldAmount * (Number(price) - Number(todayHeldPrice || yestclose || open))).toFixed(2);
          // 如果是清仓状态，今日收益为 持仓数 * (今日持仓价 - 昨日收盘价或今日开盘价)
          if (isSellOut) {
            incomeToday = (heldAmount * (Number(todayHeldPrice) - Number(yestclose || open))).toFixed(2);
            incomeTotal = (heldAmount * (Number(todayHeldPrice) - heldPrice)).toFixed(2);
          }
          const percentToday = ((Number(incomeToday) / (Number(todayHeldPrice || yestclose || open) * heldAmount)) * 100).toFixed(2);
          const percentTotal = ((Number(incomeTotal) / (heldPrice * heldAmount)) * 100).toFixed(2);

          let incomeTodayCNY = '';
          let incomeTotalCNY = '';

          const forex = forexList.find(({ filter }) => {
            if (typeof filter === 'function') {
              return filter(code);
            } else if (filter instanceof RegExp) {
              return filter.test(code);
            }
          });

          if (forex) {
            if (forex.spotSellPrice) {
              // 按现汇卖出价计算
              incomeTodayCNY = (forex.spotSellPrice * Number(incomeToday) / 100).toFixed(2);
              incomeTotalCNY = (forex.spotSellPrice * Number(incomeTotal) / 100).toFixed(2);
            }
          }

          tmp = {
            id,
            name,
            high: '' + high,
            low: '' + low,
            open,
            yestclose,
            percent,
            price,
            heldPrice,
            amount: heldAmount,
            incomeTotal,
            incomeToday,
            incomeTodayCNY,
            incomeTotalCNY,
            percentToday,
            percentTotal,
            marketCap: (heldAmount * Number(price)).toFixed(2),
          };
          stockInfo.push(tmp);
        }
      });
      const date = formatDate(new Date());
      const allIncomeToday = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.incomeTodayCNY ? cur.incomeTodayCNY : cur.incomeToday);
      }, 0);
      const allIncomeTotal = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.incomeTotalCNY ? cur.incomeTotalCNY : cur.incomeTotal);
      }, 0);
      const allMarketCap = stockInfo.reduce((prev, cur) => {
        return prev + Number(cur.marketCap);
      }, 0);      
      this.stockBarItem.text = `${PREFIX} ${toFixed(allMarketCap)} | ${toFixed(allIncomeTotal)} | ${toFixed(allIncomeToday)}`;

      const tooltip = 
      `「股票收益统计」 ${date} \n\n` +
      `| 股票名称 | 总收益 | 总收益率 | 今日盈亏 | 今日收益率| 今日涨跌 | 持仓总市值 | 最低价 | 最高价 | 开盘价 | 昨收价 | 当前价格 | 成本价格 |\n`+
      `|--------|--------:|--------:|------:|--------:|--------:|---------:|---------:|---------:|---------:|---------:|---------:|---------:|\n`+
      stockInfo
          .map((v) => {
            return `| ${v.name} | ${v.incomeTotal} ${v.incomeTotalCNY ?
              `(CNY: ${v.incomeTotalCNY})` : ''} | ${v.percentTotal}% | ${v.incomeToday} ${v.incomeTodayCNY ?
              `(CNY: ${v.incomeTodayCNY})` : ''}| ${v.percentToday}% | ${v.percent}% | ${v.marketCap} | ${v.low} | ${v.high} | ${v.open} | ${v.yestclose} | ${v.price} | ${toFixed(v.heldPrice, 4)} |\n`;
          }).join('');

      this.stockBarItem.tooltip = new vscode.MarkdownString(`
        ${tooltip}
      `);
      this.stockBarItem.show();
    }
  }

  destroy() {
    this.unsubscribe();
    // this.fundBarItem?.hide();
    this.fundBarItem?.dispose();
    this.stockBarItem?.dispose();
  }
}

import { getOracleKeeperUrl } from "config/oracleKeeper";
import { getNormalizedTokenSymbol } from "config/tokens";
import { buildUrl } from "lib/buildUrl";
import { useMemo } from "react";

const timezoneOffset = -new Date().getTimezoneOffset() * 60

function parseOracleCandle(rawCandle) {
  const [timestamp, open, high, low, close] = rawCandle;

  return {
    time: timestamp + timezoneOffset,
    open,
    high,
    low,
    close,
  };
}

export function useOracleKeeperFetcher(chainId) {
  const oracleKeeperUrl = getOracleKeeperUrl(chainId, 0);

  return useMemo(() => {
    function fetchTickers() {
      return fetch(buildUrl(oracleKeeperUrl, "/prices/tickers"))
        .then((res) => res.json())
        .then((res) => {
          if (!res.length) {
            throw new Error("Invalid tickers response");
          }

          return res;
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error(e);
          throw e;
        });
    }

    function fetch24hPrices(){
      return fetch(buildUrl(oracleKeeperUrl, "/prices/24h"))
        .then((res) => res.json())
        .then((res) => {
          if (!res?.length) {
            throw new Error("Invalid 24h prices response");
          }

          return res;
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error(e);
          throw e;
        });
    }

    async function fetchOracleCandles(tokenSymbol, period, limit) {
      tokenSymbol = getNormalizedTokenSymbol(tokenSymbol);

      return fetch(buildUrl(oracleKeeperUrl, "/prices/candles", { tokenSymbol, period, limit }))
        .then((res) => res.json())
        .then((res) => {
          if (!Array.isArray(res.candles) || (res.candles.length === 0 && limit > 0)) {
            throw new Error("Invalid candles response");
          }

          return res.candles.map(parseOracleCandle);
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error(e);
          throw e;
        });
    }

    return {
      oracleKeeperUrl,
      fetchTickers,
      fetch24hPrices,
      fetchOracleCandles,
    };
  }, [oracleKeeperUrl]);
}

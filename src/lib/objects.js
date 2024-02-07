export function setByKey(obj, key, data) {
  return { ...obj, [key]: data };
}

export function updateByKey(obj, key, data) {
  if (!obj[key]) return obj;

  return { ...obj, [key]: { ...obj[key], ...data } };
}

export function getByKey(obj, key) {
  if (!obj || !key) return undefined;

  return obj[key];
}

export const formatAddress = (address) => {
  return address? `${address.substring(0, 6)}...${address.substring(address.length-5, address.length-1)}` : '';
}
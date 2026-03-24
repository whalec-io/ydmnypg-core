function Paging(options = {}) {
  const page = Math.max(parseInt(options.page, 10) || 1, 1) - 1;
  const size = Math.max(parseInt(options.size, 10) || 20, 0);

  return {
    offset: page * size,
    size,
  };
}

export default Paging;

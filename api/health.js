module.exports = (req,res) => {
  res.setHeader('content-type','application/json');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify({ok:true,service:'vless-ws-v4.6',endpoint:'/api/ws'}));
};

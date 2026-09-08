const BASE = companyBasePath();

function redirectToBasePath(request, path) {
  const url = new URL(request.url);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return Response.redirect(`${url.origin}${BASE}${suffix}`, 302);
}

router.all('*', async (request, env) => {
  const response = await originHelix(request, env);
  if (response.status === 404) {
    // BUG: prefixes BASE -> /<company>/404.html, which is never provisioned -> loops
    return redirectToBasePath(request, '/404.html');
  }
  return response;
});

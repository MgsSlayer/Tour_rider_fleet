// Shared trip map: plots pick-up, stop-over and drop-off on one map.
//
// Dynamic Maps bills per map load, so a map is only ever created when it is
// actually going to be seen — never eagerly on page load or per dashboard card.

const TRIP_PINS = {
  pickup:   { label: 'A', title: 'Pick-up',   colour: '#0f8a4d' },
  stopover: { label: 'B', title: 'Stop over', colour: '#f5a623' },
  dropoff:  { label: 'C', title: 'Drop-off',  colour: '#b42318' },
};

// muted styling so the dark UI doesn't fight a bright default map
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
];

function pinIcon(colour, label) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: colour,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 11,
    labelOrigin: new google.maps.Point(0, 0),
  };
}

/** Same points as last time? Then the route needn't be recomputed. */
function pointsKey(points) {
  return ['pickup', 'stopover', 'dropoff']
    .map(k => (points[k] ? `${points[k].lat.toFixed(5)},${points[k].lng.toFixed(5)}` : '-'))
    .join('|');
}

/**
 * Draws the driving route.
 *
 * An encoded polyline (which the backend gets free alongside the price
 * suggestion) is drawn directly. Only without one do we spend a Directions
 * request, and never more than once per unique set of points.
 */
function drawRoute(store, points, encoded) {
  const legs = ['pickup', 'stopover', 'dropoff'].map(k => points[k]).filter(Boolean);
  if (legs.length < 2) {
    if (store.route) { store.route.setMap(null); store.route = null; }
    return;
  }

  const stroke = { strokeColor: '#f5a623', strokeOpacity: 0.9, strokeWeight: 4 };

  if (encoded && google.maps.geometry?.encoding) {
    const path = google.maps.geometry.encoding.decodePath(encoded);
    if (store.route) store.route.setMap(null);
    store.route = new google.maps.Polyline({ ...stroke, path, map: store.map });
    return;
  }

  if (store.routeKey === pointsKey(points)) return;   // already drawn for these
  store.routeKey = pointsKey(points);

  new google.maps.DirectionsService().route({
    origin: legs[0],
    destination: legs[legs.length - 1],
    waypoints: legs.slice(1, -1).map(location => ({ location, stopover: true })),
    travelMode: google.maps.TravelMode.DRIVING,
  }, (result, status) => {
    if (status !== 'OK' || !result.routes?.length) return;   // markers alone still work
    if (store.route) store.route.setMap(null);
    store.route = new google.maps.Polyline({
      ...stroke, map: store.map, path: result.routes[0].overview_path,
    });
  });
}

/**
 * Creates (or reuses) a map inside `el` and plots whichever points are given.
 * `points` is { pickup, stopover, dropoff } of {lat,lng} or null.
 */
function renderTripMap(el, points, store = {}, encodedPolyline = null) {
  if (!el || !window.google?.maps) return store;

  const plotted = Object.entries(points).filter(([, p]) => p && Number.isFinite(p.lat));
  if (!plotted.length) {
    el.hidden = true;
    return store;
  }
  el.hidden = false;

  if (!store.map) {
    store.map = new google.maps.Map(el, {
      zoom: 11,
      center: plotted[0][1],
      styles: DARK_STYLE,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'cooperative',
    });
    store.markers = {};
  }

  // drop markers that no longer apply (e.g. a cleared stop-over)
  Object.keys(store.markers).forEach((key) => {
    if (!points[key]) { store.markers[key].setMap(null); delete store.markers[key]; }
  });

  const bounds = new google.maps.LatLngBounds();
  plotted.forEach(([key, pos]) => {
    const pin = TRIP_PINS[key];
    if (store.markers[key]) {
      store.markers[key].setPosition(pos);
    } else {
      store.markers[key] = new google.maps.Marker({
        map: store.map,
        position: pos,
        title: pin.title,
        icon: pinIcon(pin.colour),
        label: { text: pin.label, color: '#fff', fontSize: '11px', fontWeight: '700' },
      });
    }
    bounds.extend(pos);
  });

  if (plotted.length === 1) {
    store.map.setCenter(plotted[0][1]);
    store.map.setZoom(13);
  } else {
    store.map.fitBounds(bounds, 48);
  }

  drawRoute(store, points, encodedPolyline);

  // a map created while hidden lays out at zero size
  google.maps.event.trigger(store.map, 'resize');
  return store;
}

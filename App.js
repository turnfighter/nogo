import React, { useEffect, useRef, useState } from "react";
import { SafeAreaView, View, Text, TextInput, FlatList, Pressable, Image, StyleSheet, Platform, Keyboard, Dimensions, Alert } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";

/* --- tiny helpers for the 'Hot singles' card --- */
const firstNames = ['Avery', 'Jordan', 'Riley', 'Taylor', 'Morgan', 'Elliot', 'Rowan', 'Charlie', 'Reese', 'Skyler', 'Alex', 'Quinn', 'Peyton', 'Dakota', 'Casey', 'Remy', 'Jamie', 'Harper', 'Sage', 'Kai'];
const lastNames = ['Hart', 'Rivera', 'Quinn', 'Stone', 'Bennett', 'Sutton', 'Hayes', 'Reid', 'Brooks', 'Cole', 'Ramos', 'Blake', 'Parker', 'Lane', 'Ellis', 'Greer', 'Monroe', 'Jensen', 'Shaw', 'Wells'];
const taglines = [
  '“Will swipe right for tacos 🌮.”', '“Left turns only, sorry.”', '“Scenic route > fastest route.”',
  '“Professional third-wheeler.”', '“Here for wrong directions & right vibes.”',
  '“Dog person. Also maps person.”', '“Let’s get lost (locally).”', '“5⭐ date, 2⭐ navigator.”'
];
const rp = a => a[Math.floor(Math.random() * a.length)];
const rName = () => `${rp(firstNames)} ${rp(lastNames)}`;
const rAge = () => Math.floor(18 + Math.random() * 21);

const ModePill = ({ label, emoji, active, onPress }) => (
  <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]} hitSlop={8}>
    <Text style={styles.pillEmoji}>{emoji}</Text>
    <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
  </Pressable>
);

/* Map OSRM profiles. OSRM supports driving | foot | bicycle */
const osrmProfile = (mode) => {
  if (mode === "walk") return "foot";
  // We’ll treat bus/train as driving for demo purposes.
  return "driving";
};

export default function App() {
  const [region, setRegion] = useState(null);
  const mapRef = useRef(null);

  /* live location */
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setRegion({ latitude: 43.6532, longitude: -79.3832, latitudeDelta: 0.05, longitudeDelta: 0.05 });
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      });
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (pos) => setRegion(r => ({ ...r, latitude: pos.coords.latitude, longitude: pos.coords.longitude }))
      );
    })();
  }, []);

  /* search / autocomplete (Photon/OSM) */
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedDest, setSelectedDest] = useState(null); // {lat, lon, name}

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) { setResults([]); setShowResults(false); return; }
      try {
        const lat = region?.latitude ?? 43.6532;
        const lon = region?.longitude ?? -79.3832;
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10&lat=${lat}&lon=${lon}&lang=en`;
        const r = await fetch(url);
        const j = await r.json();
        const items = (j.features || []).map(f => {
          const p = f.properties || {};
          const [x, y] = f.geometry.coordinates;
          const nameParts = [p.name, p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country].filter(Boolean);
          const name = [...new Set(nameParts)].join(", ") || p.osm_value || "Unnamed place";
          return { id: `${x},${y}`, name, type: p.type || "POI", lat: y, lon: x };
        });
        setResults(items);
        setShowResults(true);
      } catch {
        setResults([]); setShowResults(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, region]);

  const onPickResult = (item) => {
    setQuery(item.name);
    setShowResults(false);
    Keyboard.dismiss();
    setSelectedDest(item);
    mapRef.current?.animateToRegion({ latitude: item.lat, longitude: item.lon, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
  };

  /* modes */
  const [mode, setMode] = useState("car");

  /* routing state */
  const [routeCoords, setRouteCoords] = useState([]); // [{ latitude, longitude }, ...]
  const [destMarker, setDestMarker] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const [etaMin, setEtaMin] = useState(null);
  const [routing, setRouting] = useState(false);

  const routeTo = async (destLat, destLon) => {
    if (!region) return;
    setRouting(true);
    setRouteCoords([]);
    setDestMarker({ latitude: destLat, longitude: destLon });

    const start = `${region.longitude},${region.latitude}`;
    const end = `${destLon},${destLat}`;
    const profile = osrmProfile(mode);
    const url = `https://router.project-osrm.org/route/v1/${profile}/${start};${end}?overview=full&geometries=geojson`;

    try {
      const r = await fetch(url);
      const j = await r.json();

      if (j.code !== "Ok" || !j.routes?.length) throw new Error("No route");

      const line = j.routes[0].geometry.coordinates.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
      setRouteCoords(line);

      // distance (m) → km, duration (s) → min
      const distKm = j.routes[0].distance / 1000;
      const timeMin = j.routes[0].duration / 60;
      setDistanceKm(distKm);
      setEtaMin(timeMin);

      // fit map to route
      mapRef.current?.fitToCoordinates(line, {
        edgePadding: { top: 120, left: 60, right: 60, bottom: 260 },
        animated: true,
      });
    } catch (e) {
      // fallback: just draw a straight line so the UI still reacts
      const fallback = [
        { latitude: region.latitude, longitude: region.longitude },
        { latitude: destLat, longitude: destLon }
      ];
      setRouteCoords(fallback);
      setDistanceKm(null); setEtaMin(null);
      Alert.alert("Routing service busy", "Drew a straight line as fallback.");
    } finally {
      setRouting(false);
    }
  };

  /* “Get directions” behavior:
     - If user picked a search result -> route to that
     - Else choose a random nearby point and route there
  */
  const onGetDirections = () => {
    if (!region) return;
    if (selectedDest) {
      routeTo(selectedDest.lat, selectedDest.lon);
      return;
    }
    // random “date spot” ~1km away
    const brg = Math.random() * Math.PI * 2;
    const km = 1 + Math.random() * 3;
    const dLat = (km / 111) * Math.cos(brg);
    const dLon = (km / 111) * Math.sin(brg) / Math.cos(region.latitude * Math.PI / 180);
    const lat = region.latitude + dLat;
    const lon = region.longitude + dLon;
    routeTo(lat, lon);
  };

  /* Hot Singles card data */
  const [profile, setProfile] = useState({ name: rName(), age: rAge(), distanceKm: "–", tagline: "Refreshing your fated match…", photo: null });

  const loadPortrait = async () => {
    try {
      const r = await fetch("https://randomuser.me/api/?inc=picture&noinfo", { cache: "no-store" });
      const j = await r.json();
      const url = j?.results?.[0]?.picture?.large || j?.results?.[0]?.picture?.medium;
      if (url) { setProfile(p => ({ ...p, photo: url, tagline: rp(taglines) })); return; }
    } catch { }
    const id = Math.floor(1 + Math.random() * 70);
    setProfile(p => ({ ...p, photo: `https://i.pravatar.cc/512?img=${id}`, tagline: rp(taglines) }));
  };

  const refreshMatch = () => {
    const name = rName(); const age = rAge();
    const dk = region ? (Math.random() * 4 + 0.3).toFixed(1) : "–";
    setProfile({ name, age, distanceKm: dk, tagline: "Choosing your most photogenic match…", photo: null });
    loadPortrait();
  };
  useEffect(() => { refreshMatch(); }, []);

  const windowW = Dimensions.get("window").width;
  const isSmall = windowW < 380;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.mapWrap}>
        {region && (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            showsUserLocation
            initialRegion={region}
            onRegionChangeComplete={setRegion}
          >
            {destMarker && <Marker coordinate={destMarker} title="Mysterious date spot" />}
            {!!routeCoords.length && (
              <Polyline
                coordinates={routeCoords}
                strokeWidth={6}
                strokeColor="#ff4da6"
              />
            )}
          </MapView>
        )}

        {/* Top controls */}
        <View style={styles.controls} pointerEvents="box-none">
          {/* Search */}
          <View style={[styles.searchWrap, { width: isSmall ? 260 : 320 }]}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search for a place..."
              placeholderTextColor="#7a7a7a"
              style={styles.search}
              onFocus={() => setShowResults(true)}
            />
            {showResults && !!results.length && (
              <View style={styles.results}>
                <FlatList
                  keyboardShouldPersistTaps="handled"
                  data={results}
                  keyExtractor={(it) => it.id}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => onPickResult(item)} style={styles.resultRow}>
                      <View style={styles.pin} />
                      <View style={{ flexShrink: 1 }}>
                        <Text numberOfLines={1} style={styles.rMain}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.rSub}>{item.type}</Text>
                      </View>
                    </Pressable>
                  )}
                />
              </View>
            )}
          </View>

          {/* Modes */}
          <View style={styles.modeBar}>
            <ModePill label="Car" emoji="🚗" active={mode === "car"} onPress={() => setMode("car")} />
            <ModePill label="Walk" emoji="🚶" active={mode === "walk"} onPress={() => setMode("walk")} />
            <ModePill label="Bus" emoji="🚌" active={mode === "bus"} onPress={() => setMode("bus")} />
            <ModePill label="Train" emoji="🚆" active={mode === "train"} onPress={() => setMode("train")} />
          </View>

          {/* Go button */}
          <Pressable style={styles.goBtn} onPress={onGetDirections} disabled={routing}>
            <Text style={styles.goText}>{routing ? "Routing…" : "Get directions"}</Text>
          </Pressable>
        </View>

        {/* Hot Singles Card */}
        <View style={styles.card} pointerEvents="box-none">
          <View style={styles.cardInner}>
            <Text style={styles.cardHeader}>🔥 Hot singles in your area</Text>
            <Image source={profile.photo ? { uri: profile.photo } : null} style={styles.face} resizeMode="cover" />
            <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              <View style={styles.row}>
                <Text style={styles.name}>{profile.name}</Text>
                <Text style={styles.pillChip}>{profile.age}</Text>
                <Text style={styles.pillChip}>{profile.distanceKm} km away</Text>
              </View>
              <Text style={styles.sub} numberOfLines={2}>{profile.tagline}</Text>
              <View style={styles.actions}>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={refreshMatch}>
                  <Text style={styles.btnGhostText}>New match</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onGetDirections}>
                  <Text style={styles.btnPrimaryText}>Get directions</Text>
                </Pressable>
              </View>
              <Text style={styles.powered}>
                {distanceKm ? `~${distanceKm.toFixed(1)} km • ${etaMin ? Math.round(etaMin) : "?"} min` : "Route preview"}
              </Text>
              <Text style={styles.powered}>Photos from randomuser.me / pravatar.cc</Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

/* --- styles --- */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  mapWrap: { flex: 1 },

  controls: { position: "absolute", top: 8, left: 0, right: 0, alignItems: "center", zIndex: 20 },
  searchWrap: {
    position: "relative",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.12)",
    ...Platform.select({ android: { elevation: 3 }, ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } } })
  },
  search: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#111", width: "100%", borderRadius: 12 },
  results: {
    position: "absolute", top: 46, left: -1, right: -1, maxHeight: 280,
    backgroundColor: "#fff", borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.12)", overflow: "hidden",
  },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  pin: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#ff4da6" },
  rMain: { fontWeight: "700", fontSize: 13, color: "#111" },
  rSub: { fontSize: 12, color: "#666" },

  modeBar: { flexDirection: "row", marginTop: 8, backgroundColor: "#fff", padding: 4, borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,0,0,0.12)" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  pillActive: { backgroundColor: "#f7f7f9", borderColor: "rgba(0,0,0,0.15)" },
  pillEmoji: { fontSize: 16 },
  pillText: { fontSize: 13, color: "#222", fontWeight: "600" },
  pillTextActive: { color: "#000" },

  goBtn: {
    marginTop: 8, backgroundColor: "#ff4da6", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
    ...Platform.select({ android: { elevation: 2 }, ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } } })
  },
  goText: { color: "#111", fontWeight: "800", letterSpacing: 0.2 },

  card: { position: "absolute", right: 16, bottom: 16, zIndex: 15, maxWidth: 360 },
  cardInner: {
    backgroundColor: "#111", borderRadius: 16, overflow: "hidden",
    ...Platform.select({ android: { elevation: 8 }, ios: { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } } })
  },
  cardHeader: { color: "#fff", fontWeight: "800", fontSize: 15, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#111" },
  face: { width: "100%", height: 180, backgroundColor: "#222" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  name: { color: "#fff", fontSize: 18, fontWeight: "800", flexShrink: 1 },
  pillChip: { color: "#fff", backgroundColor: "#1f1f1f", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 12 },
  sub: { color: "#cfcfcf", fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: "#232323" },
  btnGhostText: { color: "#fff", fontWeight: "800" },
  btnPrimary: { backgroundColor: "#ff4da6" },
  btnPrimaryText: { color: "#111", fontWeight: "900" },
  powered: { color: "#9a9a9a", fontSize: 11, textAlign: "center", marginTop: 6, marginBottom: 6 },
});

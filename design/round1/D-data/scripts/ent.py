import re, sys
src = open(sys.argv[1]).read()
names = sys.argv[2:]
for n in names:
    m = re.search(r'name\s*=\s*"%s"' % re.escape(n), src)
    if not m:
        print(n, "NOT FOUND"); continue
    # take a window after the name
    w = src[m.start(): m.start()+9000]
    # cut at next top-level 'type =' occurrence after 200 chars
    nxt = re.search(r'\n  {\n    type\s*=', w[200:])
    if nxt: w = w[:200+nxt.start()]
    keys = ["crafting_speed","energy_usage","researching_speed","module_slots","mining_speed","pumping_speed","drain","pollution","max_distance","supply_area_distance","maximum_wire_distance","distribution_effectivity","energy_per_movement","energy_per_rotation","rotation_speed","speed","collision_box","crafting_categories","max_power_output","buffer_capacity","input_flow_limit","output_flow_limit","production","fluid_usage_per_tick","consumption","target_temperature","rocket_parts_required","active_energy_usage","energy_source"]
    out = []
    for k in keys:
        for mm in re.finditer(r'\b%s\s*=\s*([^,\n]+)' % k, w):
            out.append(f"{k}={mm.group(1).strip()}")
            break
    print(n, "|", "; ".join(out))

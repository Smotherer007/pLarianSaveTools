import xml.etree.ElementTree as ET
import sys

def normalize_val(val, attr_type):
    # float types: 6: Float, 7: Double, 11: Vec2, 12: Vec3, 13: Vec4, 18: Mat4
    if attr_type in ["6", "7", "11", "12", "13", "18"]:
        try:
            parts = val.split()
            # Normalize to 6 decimal places for regular comparison
            return " ".join([f"{float(p):.6f}" for p in parts])
        except:
            return val
    return val

def get_children(node):
    # Larian LSX uses <children><node ... /></children>
    children_tag = node.find('children')
    if children_tag is not None:
        return children_tag.findall('node')
    return []

def compare_nodes(orig, gen, path=""):
    if orig is None or gen is None:
        return []
    
    diffs = []
    
    # Compare attributes (incl. order)
    orig_attr_list = orig.findall('attribute')
    gen_attr_list = gen.findall('attribute')
    orig_attrs = {a.get('id'): a for a in orig_attr_list}
    gen_attrs = {a.get('id'): a for a in gen_attr_list}

    # Check attribute order
    for i in range(min(len(orig_attr_list), len(gen_attr_list))):
        oid = orig_attr_list[i].get('id')
        gid = gen_attr_list[i].get('id')
        if oid != gid:
            diffs.append(f"ATTR ORDER: {path} attr {i} | Original: {oid} | Generated: {gid}")
            break

    for attr_id in set(orig_attrs.keys()) | set(gen_attrs.keys()):
        if attr_id not in gen_attrs:
            diffs.append(f"MISSING ATTR: {path}/{attr_id} (Expected {orig_attrs[attr_id].get('value')})")
        elif attr_id not in orig_attrs:
            diffs.append(f"EXTRA ATTR: {path}/{attr_id} (Found {gen_attrs[attr_id].get('value')})")
        else:
            oa = orig_attrs[attr_id]
            ga = gen_attrs[attr_id]
            ov_raw = oa.get('value')
            gv_raw = ga.get('value')
            ov_norm = normalize_val(ov_raw, oa.get('type'))
            gv_norm = normalize_val(gv_raw, ga.get('type'))
            
            if ov_norm != gv_norm:
                diffs.append(f"DIFF VALUE: {path}/{attr_id} | Original: {ov_raw} | Generated: {gv_raw}")

    orig_children = get_children(orig)
    gen_children = get_children(gen)
    
    # Check order
    for i in range(min(len(orig_children), len(gen_children))):
        oid = orig_children[i].get('id')
        gid = gen_children[i].get('id')
        if oid != gid:
            diffs.append(f"ORDER ISSUE: {path} child {i} | Original: {oid} | Generated: {gid}")
            break

    orig_by_id = {}
    for i, c in enumerate(orig_children):
        node_id = c.get('id')
        if node_id not in orig_by_id: orig_by_id[node_id] = []
        orig_by_id[node_id].append(c)
        
    gen_by_id = {}
    for i, c in enumerate(gen_children):
        node_id = c.get('id')
        if node_id not in gen_by_id: gen_by_id[node_id] = []
        gen_by_id[node_id].append(c)

    for node_id in set(orig_by_id.keys()) | set(gen_by_id.keys()):
        if node_id not in gen_by_id:
            diffs.append(f"MISSING NODE: {path}/{node_id} (x{len(orig_by_id[node_id])})")
        elif node_id not in orig_by_id:
            diffs.append(f"EXTRA NODE: {path}/{node_id} (x{len(gen_by_id[node_id])})")
        else:
            o_list = orig_by_id[node_id]
            g_list = gen_by_id[node_id]
            if len(o_list) != len(g_list):
                diffs.append(f"DIFF COUNT: {path}/{node_id} | Original: {len(o_list)} | Generated: {len(g_list)}")
            
            for i in range(min(len(o_list), len(g_list))):
                sub_path = f"{path}/{node_id}" if len(o_list) == 1 else f"{path}/{node_id}[{i}]"
                diffs.extend(compare_nodes(o_list[i], g_list[i], sub_path))

    return diffs

def main(orig_path, gen_path):
    print(f"Comparing all regions in\n  Original:  {orig_path}\n  Generated: {gen_path}\n")
    try:
        orig_tree = ET.parse(orig_path)
        gen_tree = ET.parse(gen_path)
    except Exception as e:
        print(f"Error parsing XML: {e}")
        return

    orig_regions = {r.get('id'): r for r in orig_tree.getroot().findall('region')}
    gen_regions = {r.get('id'): r for r in gen_tree.getroot().findall('region')}
    
    all_diffs = []
    
    for rid in set(orig_regions.keys()) | set(gen_regions.keys()):
        if rid not in gen_regions:
            all_diffs.append(f"MISSING REGION: {rid}")
        elif rid not in orig_regions:
            all_diffs.append(f"EXTRA REGION: {rid}")
        else:
            or_node = orig_regions[rid].find('node')
            gr_node = gen_regions[rid].find('node')
            all_diffs.extend(compare_nodes(or_node, gr_node, f"region[{rid}]"))
    
    if not all_diffs:
        print("OK: No significant semantic differences found.")
    else:
        print(f"Found {len(all_diffs)} differences:")
        # Group by type and show
        for d in all_diffs[:500]:
            print(f"  {d}")
        if len(all_diffs) > 500:
            print(f"  ... and {len(all_diffs) - 500} more.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python compare_lsx.py <original.lsx> <generated.lsx>")
    else:
        main(sys.argv[1], sys.argv[2])

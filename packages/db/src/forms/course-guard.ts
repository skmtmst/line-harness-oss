// A condition on the write itself closes the gap between checking a course and saving the form.
export const validRestaurantCoursesSql = `NOT EXISTS (
  SELECT 1 FROM json_each(json_array(?,?)) document,
    json_tree(CASE WHEN json_valid(document.value) THEN document.value ELSE '{}' END) node
  WHERE node.type='object'
    AND json_extract(CASE WHEN node.type='object' THEN node.value ELSE '{}' END,'$.kind')='seats'
    AND COALESCE(json_extract(CASE WHEN node.type='object' THEN node.value ELSE '{}' END,'$.courseId'),'')<>''
    AND NOT EXISTS (SELECT 1 FROM rt_menu_items m
      WHERE m.id=json_extract(node.value,'$.courseId') AND m.store_id=json_extract(node.value,'$.storeId'))
)`;


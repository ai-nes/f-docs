import { Node } from '@tiptap/pm/model';

export function updateAttachmentAttr(
  node: Node,
  attr: 'src' | 'url',
  token: string,
) {
  const attrVal = node.attrs[attr];
  if (
    typeof attrVal === 'string' &&
    isPrivateAttachmentUrl(attrVal)
  ) {
    // @ts-ignore
    node.attrs[attr] = updateAttachmentUrl(attrVal, token);
  }
}

function updateAttachmentUrl(src: string, jwtToken: string) {
  const updatedSrc = src.replace('/files/', '/files/public/');
  const separator = updatedSrc.includes('?') ? '&' : '?';
  return `${updatedSrc}${separator}jwt=${jwtToken}`;
}

function isPrivateAttachmentUrl(value: string) {
  return (
    !value.includes('/files/public/') &&
    // Attachments are currently generated with UUID v7. Keep accepting the
    // older UUID versions as well so public shares can rewrite both old and
    // newly imported attachment URLs.
    /(?:^|\/)(?:api\/)?files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/|$)/i.test(
      value,
    )
  );
}

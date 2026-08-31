import { DB } from '@f-doc/db/types/db';
import { PageEmbeddings } from '@f-doc/db/types/embeddings.types';

export interface DbInterface extends DB {
  pageEmbeddings: PageEmbeddings;
}
